Under each point/item below there is my comment, please take in consideration these when fixing, marked with (comment).

---

## 🔴 Critical — docs contradict the actual code

A developer copy-pasting from the docs will get broken code or wrong behavior.

- [x] **Hooks page has the wrong handler signature.** `events-hooks/hooks.md` uses
  `({ job }) => …` for `BEFORE_ADD`/`AFTER_ADD` and reads `job.data` /
  `job.idempotencyKey`. The real context is `{ queue, options }` for `BEFORE_ADD`
  and `{ result }` for `AFTER_ADD` (`hooks.ts:35-42`). Only `BEFORE_PROCESS`/
  `AFTER_PROCESS` get `{ job }`. The main "mutate an outgoing job" example does
  not work as written.
  (comment- fix the docs and show the exact usage)

- [x] **CLI `retry --yes` flag doesn't exist.** `cli.md` shows
  `./pq retry --id <jobId> --yes` in several places; `retry.ts` only reads `--id`.
  (`--yes` only exists on `purge`.)
  (comment - fix teh docs)


- [x] **`pollIntervalMs` default is wrong.** Docs say `5000`; code uses
  `notifyCapable ? 5000 : 1000` (`port-queue.ts:169`) — so it's `1000ms` for
  SQLite/MySQL and other non-LISTEN/NOTIFY drivers.
  (comment - fix the implementation should be 5000 for both cases and drivers)

- [x] **`ShutdownOptions.drain` is documented as functional but is a no-op** —
  `shutdown()` only consumes `graceful` and `timeoutMs` (`port-queue.ts:109-114`).
  (comment - fix teh docs)

- [x] **`removeJob` "skips ACTIVE and returns false" claim is unverified in the
  single-id path.** The ACTIVE guard only clearly lives in `removeJobs` by-status
  (`queue.ts:135`); `removeJob` calls the driver unconditionally. Reconcile doc vs. code.
  (comment - fix the implementation the removeJob should skip ones that are ACTIVE)

- [x] **`clock` and `metadata` are referenced in guidance but missing from the API
  reference.** `testing.md` and `production.md` tell you to pass `clock` / use
  `metadata`, but neither appears in `PortQueueOptions` / `AddJobOptions` tables.
  Either add them or fix the prose.
  (comment - fix the docs, no need to document that)

---

## 🟠 Coverage gaps — public API in code but not documented

- [x] **Instance/queue events missing from `events.md`:** `QUEUE_REMOVED`,
  `INSTANCE_PAUSED`, `INSTANCE_RESUMED`, `INSTANCE_REMOVED` are all emitted
  (`port-queue.ts:249,270,284,301`) but there's no "Instances" section.
  `scale-horizontally.md` even references them.
  (comment - add missing to docs)

- [x] **CLI is missing ~11 commands.** Documented: stats, listen, retry,
  remove-instance, remove-queue, dashboard, migrate. Undocumented but registered:
  `queues`, `jobs`, `job`, `schedules`, `add`, `cancel`, `remove`, `purge`,
  `pause`, `resume`, `doctor`. Also missing dashboard flags: `--host`,
  `--read-only`, `--base-path`, and the default port `4321`.
  (comment - fix the docs, add missing and fix existing command to follow the implementation)

- [x] **`tx?` is claimed on "all producing methods" but only shown on `removeJob`.**
  Code supports it on `addJob`, `retryJob`, `cancelJob`, `removeJob`, `removeJobs`,
  `removeSchedule` — add it to each signature.
  (comment - fix the implementation make sure all support tx, I mean the methods that can be called like queue. or portqueue.)

- [x] **Error classes not documented.** ~12 exported error classes
  (`JobNotFoundError`, `QueuePausedError`, `MissingPeerDependencyError`,
  `SchemaVersionMismatchError`, etc.) aren't listed anywhere.
  (comment - document them, maybe in the troubleshot docs)

- [x] **CODE BUG (surface to maintainer): `InstanceActiveError` and `QueueInUseError`
  are thrown to users but NOT exported** from the package barrel.
  (comment - export them, and make sure to export any error or anything that is documented in docs as if teh dev can use)

- [x] **`DriverCapability` enum, `Driver` contract types, and schema identifier
  exports** (`TableName`, `QueueColumn`, etc.) are public but absent from the API
  reference / advanced page — the "write your own driver" page can't be followed
  (it shows `// …methods per the Driver interface` with no signatures).
  (comment - fix the docs)

---

## 🟡 Missing type definitions (referenced everywhere, defined nowhere)

- [x] **`Duration` string grammar** — used ~20 times (`'24h'`, `'30s'`, `'5m'`)
  across 6 files and never defined. What units? Are ms numbers allowed? `'1d12h'`?
  Highest-value single fix. Add one authoritative reference and link it everywhere.
  (comment - id docs when showing scheduled examples just in code examples have comments with the duration capabilities)

- [x] **Cron dialect** — `'0 8 * * 1-5'` used in 3 files; never says 5-field vs
  6-field/seconds, timezone/DST behavior, or catch-up-on-restart semantics.
  (comment - somewhere in code where we have crons have a code comment about that)

- [x] **Other undefined-but-referenced types:** `CronSpec`, `JobHandler`
  (signature + what a return value does), `BeforeAddResult`, `ProcessOutcome`,
  `HookRegistration`, `Logger`/log levels, the `clock` interface, `DriverProbe`,
  and the `counts` shape used in `QueueInfo`/`InstanceInfo`/`QueueStats`.
  (comment - make sure these types are exported)

---

## 🟢 Developer-experience improvements

### Getting started / setup
- [x] **No canonical setup block.** Every guide starts mid-stream with `pq` /
  `driver` / `emailsQueue` already existing. Add one "assumes this setup" block and
  link it from every guide.
  (comment - thats good no need to fix)

- [x] **`installation.mdx` lacks prerequisites** (Node version, TS, that the DB must
  already exist, what `DATABASE_URL` looks like), teardown (`shutdown()`), and
  error-handling for `init()` failures.
  (comment - thats good no need to fix, devs will usually already have a db before needing our tool)

- [x] **Peer-dependency requirement only appears on the Docker page.** CLI,
  dashboard-mount, and testing pages all connect to a DB but never tell you to
  install `pg`/etc. — users will hit `MISSING_PEER_DEPENDENCY`.
  (comment - where needed in docs put small comments that do not forget to have the needed peer deps installed)

### Concept clarity / footguns
- [x] **`cancelJob` only fires the AbortSignal on the same instance.** In a
  multi-instance fleet (the headline feature), canceling a job running elsewhere
  doesn't signal the handler — buried in prose, deserves a prominent warning.
  (comment - in docs have just a simple info alert under that method)

- [x] **`preferredInstanceKeyPattern` / affinity regex is unanchored** —
  `'ram-(4|8)gb'` substring-matches `ram-48gb`. Not stated anywhere; add
  anchoring/escaping guidance.
  (comment - fix the example in docs, use a regex without this problem)

- [x] **`batchSize` vs `concurrency` interaction** isn't explained (common
  confusion), and `extendLock` doesn't explain when the automatic heartbeat is
  insufficient.
  (comment - explain that in docs in teh consuming jobs page)

- [x] **Transactions page (`transactions.mdx`) has no visible end-to-end code** —
  the core pattern (open tx → business write → `addJob({ tx })` → commit) is
  entirely delegated to a tab component. Also `NOTIFY`-after-commit is
  Postgres-specific; state per-engine wake behavior. Highest-value feature to show
  concretely.
  (comment - have a better example on that page)

- [x] **`retention.md` only shows `DELETE_AFTER`** — never lists the full
  `RetentionMode` enum, when pruning runs, or whether count-based retention
  (BullMQ's `removeOnComplete: { count }`) exists.
  (comment - in retention page explain the full capabilities of retention)

- [x] **Scheduling gaps:** `startEvery` drift/overlap semantics, cron catch-up after
  downtime, and "how do I update a schedule" (remove + re-add is the only path) are
  all unstated.
  (comment - in docs have a note in the scheduling page say that the correct way is to remove a schedule and add another after)

### Reference / ops pages
- [x] **snake_case DB columns leak into prose** (`preferred_instance_key_pattern`,
  `processed_on_instance_key`) with advice to "widen the pattern on pending rows"
  but no API to do it — say explicitly it requires raw SQL.
  (comment - fix the docs)

- [x] **`troubleshooting.md`:** error codes with "—" for class need a note they're
  still `PortQueueError` (avoid `instanceof` confusion); add "jobs never picked up"
  (affinity mismatch) and schema/table-prefix-mismatch symptoms.
  (comment - fix docs)

- [x] **`dashboard.mdx`:** no install instruction on the mount path, no screenshot,
  "custom auth" mode has no example, and the `basePath` vs each framework's own
  routing relationship is unreconciled. The `****` password placeholders read as
  literal.
  (comment - fix the docs, but images not for now, we'll add later)

- [x] **`testing.md`:** the headline `clock` feature has no code example (interface?
  how to advance it?), and no "wait for job to finish" pattern — exactly where new
  users get stuck.
  (comment - fix teh docs, we won't allow users to pass a custom clock for now, just remove teh references from docs)

- [x] **`examples.md` is thin** (3 examples, all PGLite). Missing: retries/backoff,
  idempotency/singleton, transactional enqueue, graceful shutdown, and a **real
  Postgres connection** example (everything uses PGLite, but devs ship against real
  DBs).
  (comment - add more examples, then ask me to run npm install, just add teh examples and the pkg json and then ask to run npm install and asc for confirmation)

---

## Suggested order of attack

1. Fix the 🔴 code-contradiction items first (they actively mislead).
2. Define **`Duration`** and **cron** once and link everywhere (biggest reach).
3. Add the **canonical setup block** and a **concrete transactions example**.
4. Surface the two unexported-but-thrown error classes (`InstanceActiveError`,
   `QueueInUseError`) to the maintainer as an actual code bug.
