# 16 — Testing Strategy

Jest across the monorepo, aiming for **very high coverage** (target 100% where sensible, accepting it won't be fully reachable). Tests must be **fast**, **isolated**, and **use only PGLite + SQLite** as the DB drivers (the easiest to run in CI with no external services).

## 16.1 Test drivers: PGLite + SQLite only

- **PGLite** covers the Postgres dialect (SKIP LOCKED, RETURNING, JSONB, LISTEN/NOTIFY where available, transactions) — so the Postgres code paths are exercised without a Postgres server.
- **SQLite** covers the no-LISTEN/NOTIFY + atomic-update-claim fallback + TEXT-JSON + app-generated-UUID paths.
- Between them, both major driver strategies are tested. **Postgres and Oracle are not required in CI**; their drivers are validated by the shared **conformance kit** (16.6) which teams can run against a real server, and PGLite proves the shared Postgres dialect.
- **In-memory first:** use PGLite in-memory and SQLite `:memory:` for speed. When a file-backed DB is needed, always clean up the file at the end.

## 16.2 Isolation: a clean DB per suite

- Every `describe`/spec gets a **fresh, clean database** (new in-memory instance or a uniquely-named/temp file), migrated fresh, torn down after. No shared mutable state across specs, so tests are order-independent and parallelizable.
- Tests live **inside each package** — co-located `*.test.ts` / `__tests__/` under that package's `src/`. There is **no `packages/testing` package**; `packages/` holds exactly `core`, `dashboard`, `cli`, `ui`, `eslint-config` (file 01).
- A shared helper (`createTestQueue({ engine })`) that spins up a clean PortQueue on the chosen test driver and returns it plus a `cleanup()` lives in a **non-published test-utils folder inside `packages/core`** (e.g. `packages/core/src/test-utils/`, excluded from the published `files` whitelist). Other packages import it via the workspace for their own tests.

## 16.3 Minimal mocking

- **Mock third-party libraries as little as possible.** If a library would need heavy mocking, prefer replacing that need with our own small implementation (raw-plan guidance) — this is another reason core avoids runtime deps.
- The DB is **real** (PGLite/SQLite), not mocked — queue behavior is meaningless against a fake DB.
- Time is controlled with a **fake clock** (Jest fake timers + an injectable `now()`/clock in scheduler/backoff/retention services) so delayed/cron/retention logic is tested deterministically **without real waiting** (16.5).

## 16.4 Test categories

- **Unit** — pure helpers (`util/`: backoff math, cron next-run, duration parsing, option resolution/precedence, identifier validation). Fully covered.
- **Behavioral / integration** (the bulk) — against PGLite & SQLite: add→claim→complete, retries/backoff, priority ordering, delayed availability, idempotency & singleton uniqueness, multi-step transitions + resume-after-simulated-crash, scheduling/cron production sharing `scheduleId`, retention deletion in batches, pause/resume semantics, graceful shutdown & lock release.
- **Concurrency** — simulate N workers/instances against one DB and assert **no double-processing** (each job runs exactly-once-claimed), no double-production of recurring jobs, correct stalled-reclaim after a simulated crash (drop a lock, advance clock past `locked_until`).
- **Transactions** — enqueue inside a transaction that commits (job exists) vs rolls back (job absent); notify-after-commit; adopt-external.
- **Fault tolerance** — throwing handlers, throwing hooks/listeners, non-Error throws, handler that ignores `AbortSignal` on shutdown: assert the loop never crashes and outcomes are correct.
- **Security** — see file 18: injection attempts via queue names / prefixes / payloads / idempotency keys; assert parameterization/identifier-escaping holds; dashboard auth/readOnly enforcement; CLI input handling.
- **Driver conformance** — the shared kit (16.6) run against PGLite & SQLite in CI (and optionally Postgres/Oracle locally).
- **Dashboard/CLI** — the server API (mount, auth, readOnly, action validation) tested with supertest-style calls; the client with React Testing Library for critical flows; CLI commands tested by invoking the command layer with a test PortQueue and asserting output/exit codes.

## 16.5 Timing rules (fast tests)

- **No test waits on real wall-clock delays.** Delayed jobs, cron next-runs, retry backoff, retention TTLs, and visibility timeouts are all driven by an **injectable clock** advanced manually. A cron test asserts the computed `next_run_at`, not that a job appears "in an hour."
- Where a real timer genuinely must elapse (e.g. a poll loop tick), cap it to **well under a few seconds**, and prefer triggering the loop directly. The raw-plan ceiling ("up to a few seconds, at most a minute") is a hard upper bound — most timing tests should be milliseconds.

## 16.6 Driver conformance kit

- Exported from the `@portqueue/core/conformance` subpath: a parameterized suite that takes a `Driver` factory and asserts the contract (file 03) — claim atomicity, ordering (`priority`, `start_after`), visibility timeout/reclaim, RETURNING/insert semantics, idempotency/singleton uniqueness, transactional enqueue, schedule upsert idempotency.
- Run in-repo against PGLite & SQLite. Shipped so **custom-driver authors** validate their driver the same way (file 03.6).

## 16.7 Coverage policy

- Coverage focus is the **pure logic and driver behavior** (the parts a queue is actually made of), per `project-structure` — not framework-shaped glue.
- Gate CI on coverage thresholds for `packages/core` (high, e.g. 90%+ lines/branches with a documented aspiration to 100% on `util/` and core services). Dashboard client UI is tested for critical flows, not chased to 100%.
- `--max-warnings=0` lint + typecheck are part of the same CI gate (file 17).

## 16.8 Local final-check checklist

- [ ] Only PGLite + SQLite used as test drivers; in-memory by default; file-backed cleaned up.
- [ ] Fresh clean DB per describe/spec; tests order-independent and parallel-safe.
- [ ] Injectable clock drives all delay/cron/backoff/retention/visibility tests; no real waiting; hard cap seconds.
- [ ] Concurrency tests prove no double-processing / no double-production / correct stalled-reclaim.
- [ ] Transaction, fault-tolerance, and security tests exist.
- [ ] Conformance kit runs against both test drivers and is shipped for custom-driver authors.
- [ ] Minimal third-party mocking; the DB is real.
