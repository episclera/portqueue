# Docs Review — TODO

A full review of the Docusaurus docs (`docs/`), cross-checked against the actual
`@portqueue/core` and `@portqueue/cli` source. Grouped by priority. From the
perspective of a developer installing and using the library for the first time.

---

## 🔴 Critical — docs contradict the actual code

A developer copy-pasting from the docs will get broken code or wrong behavior.

- [ ] **Hooks page has the wrong handler signature.** `events-hooks/hooks.md` uses
  `({ job }) => …` for `BEFORE_ADD`/`AFTER_ADD` and reads `job.data` /
  `job.idempotencyKey`. The real context is `{ queue, options }` for `BEFORE_ADD`
  and `{ result }` for `AFTER_ADD` (`hooks.ts:35-42`). Only `BEFORE_PROCESS`/
  `AFTER_PROCESS` get `{ job }`. The main "mutate an outgoing job" example does
  not work as written.
- [ ] **CLI `retry --yes` flag doesn't exist.** `cli.md` shows
  `./pq retry --id <jobId> --yes` in several places; `retry.ts` only reads `--id`.
  (`--yes` only exists on `purge`.)
- [ ] **`pollIntervalMs` default is wrong.** Docs say `5000`; code uses
  `notifyCapable ? 5000 : 1000` (`port-queue.ts:169`) — so it's `1000ms` for
  SQLite/MySQL and other non-LISTEN/NOTIFY drivers.
- [ ] **`ShutdownOptions.drain` is documented as functional but is a no-op** —
  `shutdown()` only consumes `graceful` and `timeoutMs` (`port-queue.ts:109-114`).
- [ ] **`removeJob` "skips ACTIVE and returns false" claim is unverified in the
  single-id path.** The ACTIVE guard only clearly lives in `removeJobs` by-status
  (`queue.ts:135`); `removeJob` calls the driver unconditionally. Reconcile doc vs. code.
- [ ] **`clock` and `metadata` are referenced in guidance but missing from the API
  reference.** `testing.md` and `production.md` tell you to pass `clock` / use
  `metadata`, but neither appears in `PortQueueOptions` / `AddJobOptions` tables.
  Either add them or fix the prose.

---

## 🟠 Coverage gaps — public API in code but not documented

- [ ] **Instance/queue events missing from `events.md`:** `QUEUE_REMOVED`,
  `INSTANCE_PAUSED`, `INSTANCE_RESUMED`, `INSTANCE_REMOVED` are all emitted
  (`port-queue.ts:249,270,284,301`) but there's no "Instances" section.
  `scale-horizontally.md` even references them.
- [ ] **CLI is missing ~11 commands.** Documented: stats, listen, retry,
  remove-instance, remove-queue, dashboard, migrate. Undocumented but registered:
  `queues`, `jobs`, `job`, `schedules`, `add`, `cancel`, `remove`, `purge`,
  `pause`, `resume`, `doctor`. Also missing dashboard flags: `--host`,
  `--read-only`, `--base-path`, and the default port `4321`.
- [ ] **`tx?` is claimed on "all producing methods" but only shown on `removeJob`.**
  Code supports it on `addJob`, `retryJob`, `cancelJob`, `removeJob`, `removeJobs`,
  `removeSchedule` — add it to each signature.
- [ ] **Error classes not documented.** ~12 exported error classes
  (`JobNotFoundError`, `QueuePausedError`, `MissingPeerDependencyError`,
  `SchemaVersionMismatchError`, etc.) aren't listed anywhere.
- [ ] **CODE BUG (surface to maintainer): `InstanceActiveError` and `QueueInUseError`
  are thrown to users but NOT exported** from the package barrel.
- [ ] **`DriverCapability` enum, `Driver` contract types, and schema identifier
  exports** (`TableName`, `QueueColumn`, etc.) are public but absent from the API
  reference / advanced page — the "write your own driver" page can't be followed
  (it shows `// …methods per the Driver interface` with no signatures).

---

## 🟡 Missing type definitions (referenced everywhere, defined nowhere)

- [ ] **`Duration` string grammar** — used ~20 times (`'24h'`, `'30s'`, `'5m'`)
  across 6 files and never defined. What units? Are ms numbers allowed? `'1d12h'`?
  Highest-value single fix. Add one authoritative reference and link it everywhere.
- [ ] **Cron dialect** — `'0 8 * * 1-5'` used in 3 files; never says 5-field vs
  6-field/seconds, timezone/DST behavior, or catch-up-on-restart semantics.
- [ ] **Other undefined-but-referenced types:** `CronSpec`, `JobHandler`
  (signature + what a return value does), `BeforeAddResult`, `ProcessOutcome`,
  `HookRegistration`, `Logger`/log levels, the `clock` interface, `DriverProbe`,
  and the `counts` shape used in `QueueInfo`/`InstanceInfo`/`QueueStats`.

---

## 🟢 Developer-experience improvements

### Getting started / setup
- [ ] **No canonical setup block.** Every guide starts mid-stream with `pq` /
  `driver` / `emailsQueue` already existing. Add one "assumes this setup" block and
  link it from every guide.
- [ ] **`installation.mdx` lacks prerequisites** (Node version, TS, that the DB must
  already exist, what `DATABASE_URL` looks like), teardown (`shutdown()`), and
  error-handling for `init()` failures.
- [ ] **Peer-dependency requirement only appears on the Docker page.** CLI,
  dashboard-mount, and testing pages all connect to a DB but never tell you to
  install `pg`/etc. — users will hit `MISSING_PEER_DEPENDENCY`.

### Concept clarity / footguns
- [ ] **`cancelJob` only fires the AbortSignal on the same instance.** In a
  multi-instance fleet (the headline feature), canceling a job running elsewhere
  doesn't signal the handler — buried in prose, deserves a prominent warning.
- [ ] **`preferredInstanceKeyPattern` / affinity regex is unanchored** —
  `'ram-(4|8)gb'` substring-matches `ram-48gb`. Not stated anywhere; add
  anchoring/escaping guidance.
- [ ] **`batchSize` vs `concurrency` interaction** isn't explained (common
  confusion), and `extendLock` doesn't explain when the automatic heartbeat is
  insufficient.
- [ ] **Transactions page (`transactions.mdx`) has no visible end-to-end code** —
  the core pattern (open tx → business write → `addJob({ tx })` → commit) is
  entirely delegated to a tab component. Also `NOTIFY`-after-commit is
  Postgres-specific; state per-engine wake behavior. Highest-value feature to show
  concretely.
- [ ] **`retention.md` only shows `DELETE_AFTER`** — never lists the full
  `RetentionMode` enum, when pruning runs, or whether count-based retention
  (BullMQ's `removeOnComplete: { count }`) exists.
- [ ] **Scheduling gaps:** `startEvery` drift/overlap semantics, cron catch-up after
  downtime, and "how do I update a schedule" (remove + re-add is the only path) are
  all unstated.

### Reference / ops pages
- [ ] **snake_case DB columns leak into prose** (`preferred_instance_key_pattern`,
  `processed_on_instance_key`) with advice to "widen the pattern on pending rows"
  but no API to do it — say explicitly it requires raw SQL.
- [ ] **`troubleshooting.md`:** error codes with "—" for class need a note they're
  still `PortQueueError` (avoid `instanceof` confusion); add "jobs never picked up"
  (affinity mismatch) and schema/table-prefix-mismatch symptoms.
- [ ] **`dashboard.mdx`:** no install instruction on the mount path, no screenshot,
  "custom auth" mode has no example, and the `basePath` vs each framework's own
  routing relationship is unreconciled. The `****` password placeholders read as
  literal.
- [ ] **`testing.md`:** the headline `clock` feature has no code example (interface?
  how to advance it?), and no "wait for job to finish" pattern — exactly where new
  users get stuck.
- [ ] **`examples.md` is thin** (3 examples, all PGLite). Missing: retries/backoff,
  idempotency/singleton, transactional enqueue, graceful shutdown, and a **real
  Postgres connection** example (everything uses PGLite, but devs ship against real
  DBs).

---

## Suggested order of attack

1. Fix the 🔴 code-contradiction items first (they actively mislead).
2. Define **`Duration`** and **cron** once and link everywhere (biggest reach).
3. Add the **canonical setup block** and a **concrete transactions example**.
4. Surface the two unexported-but-thrown error classes (`InstanceActiveError`,
   `QueueInUseError`) to the maintainer as an actual code bug.
