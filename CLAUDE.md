# Working with Claude Code — PortQueue

This repo follows the `ai-utils` shared-lib guardrails. Key rules for any AI assistant working here:

## Hard rules
- **Never run package installs** (`npm install`/`ci`, `pnpm`, `yarn`, `bun`). When deps are needed, print the exact command and ask the user to run it.
- **Never auto-commit, push, or publish.** Print the commands; a human runs them. CI is the only actor that publishes.
- **Never create git branches.** Always work on the **current branch**. Only create a branch when the user explicitly asks for it in a prompt — never on your own initiative, and never as a step before committing.
- **Never interactive logins** or anything needing network/credentials — surface the command for the user.
- **Keep the docs in sync with the public API.** Every time the public API of the tool (`@portqueue/core`), the dashboard, or the CLI changes — new/renamed/removed options, methods, DTOs, events, endpoints, or CLI flags — check the Docusaurus site under `docs/` and improve the developer-facing docs if needed (guides, API reference, dashboard/CLI pages, and register any new page in `docs/sidebars.ts`).
- **Keep the examples list in sync.** Every time you add a new example under `examples/`, list it (with a link) on the Examples docs page (`docs/docs/examples.md`) and in the examples index (`examples/README.md`). Add a launcher under `scripts/dev/examples/` and a matching `example:*` script in the root `package.json`.

## Always end with a short change report
Finish **every** prompt — fix, refactor, feature, docs tweak, anything that touched a file — with a
brief report printed directly in the Claude Code console. Keep it scannable, not exhaustive:

- **What changed** — a handful of bullets in plain language, grouped by area (core / dashboard / CLI
  / docs), naming the file or option only where it helps the reader find it.
- **What it affects** — behaviour or API that is now different, anything that could break a caller,
  and whether tests/lint/build were run and passed. Say so plainly if something failed or was
  skipped.
- **Worth your attention** — the one or two things the user should actually look at or decide:
  a judgement call made on their behalf, a manual step they must take (drop a dev database, run an
  install), a trade-off worth confirming.

Aim for something read in under a minute. No restating the whole diff, no repeating the same point
in three sections, and no section at all when there is nothing to put in it.

## Design invariants
- **Seconds are the only unit of time in the API.** Every duration a caller can set — public option,
  internal option, DB column, DTO field, CLI flag, dashboard field, event payload — is a number of
  **seconds** and its name says so (`expireInSeconds`, `lockDurationSeconds`, `retry_delay_seconds`,
  `--every <seconds>`, `durationSeconds`). There is no duration-string parsing anywhere: `'1m'` reads
  as a month to some people and a minute to others, so it is a type error rather than a silent
  misconfiguration. **Never** add a `*Ms` option, column, or payload field, and never accept a unit
  string. Instants stay `Date` on the public surface. `util/seconds.ts` is the **only** place seconds
  meet milliseconds — the clock, `setTimeout`/`setInterval` and every stored *instant* are epoch-ms, so
  a duration is multiplied by 1000 exactly once, there. It exports exactly three converters and there
  is **no inline `* 1000` anywhere else in the codebase**: `wholeSecondsToMs` (validated whole
  seconds), `secondsToMs` (the fractional-tolerant one, for the loop cadences the invariant exempts —
  and the only one that accepts a negative value, because `extendLock` releases a lock by pushing its
  deadline into the past), and `msToSeconds` for reporting a duration back.
- **Every default lives in `constants/`, never inline.** `packages/core/src/constants/` holds one file
  per scope (`time`, `worker`, `paging`, `maintenance`, `job`, `storage`) and every use site imports
  from it. A caller-overridable default is `DEFAULT_*`; a fixed internal bound (a batch size, a scan
  cap, a multiplier) is unprefixed SCREAMING_CASE. This exists because the heartbeat window used to be
  a literal `15` and a literal `× 3` in four separate files, which is three chances to drift.
- **A duration that reaches the database is a *whole* number of seconds.** That is every option
  describing a job's own timing — `expireInSeconds`, `retry.delaySeconds`,
  `retry.backoff.maxDelaySeconds`, `retention.ttlSeconds`, `schedule.startAfterSeconds`,
  `schedule.startEverySeconds`, `limiter.rateDurationSeconds`. Their columns are **integer** types
  and `wholeSeconds()` rejects a fraction up front, so an engine never silently truncates one. Never
  widen a duration column to a float to make a fractional value fit — reject the value instead.
  The exception, and it is the only one: the process-local loop cadences that are never stored —
  `tickIntervalSeconds`, `limiter.pollIntervalSeconds`, `limiter.lockDurationSeconds`,
  `instance.heartbeatIntervalSeconds`, `monitor.sampleIntervalSeconds`,
  `monitor.maxEventLoopDelaySeconds`, `shutdown({ timeoutSeconds })` — accept fractions, because they
  are timer intervals and thresholds where sub-second values are genuinely meaningful (a 200 ms
  event-loop-delay threshold is useful; a 1 s one is not). They still carry the `Seconds` suffix and
  still never appear in a row.
- **One option per thing — never two spellings of the same setting.** If an option already exists,
  extend or rename it; do not add a second option that reaches the same outcome by another route (an
  absolute `Date` beside a seconds delay, a unit string beside a number, a singular beside a plural).
  Two doors to one room double the validation, the docs, the tests and the ways a caller can be
  wrong. A delay is `startAfterSeconds` and nothing else; a caller who has an instant subtracts.
- **`PortQueue` is the whole developer surface; the handle has no methods.** `createQueue` returns a
  *registration*, not a control surface — `Queue` carries its name and payload type and nothing else.
  Every operation is a method on `pq` that takes `queue` as a named argument
  (`pq.addJob({ queue, data })`, `pq.getJobs({ queue })`, `pq.pauseQueue({ queue })`). Never add a
  method to `Queue`. Two reasons this is the right shape, both learned the hard way: a
  queue-scoped handle that forwards to an unscoped read silently returns another queue's row typed as
  this queue's payload; and code touching five queues should pass five names to one object rather than
  thread five handles through its own plumbing.
- **A queue declares its own consumer — there is no `createWorker` and no `Worker` on the surface.**
  `createQueue({ name, handler, limiter, dontAutoretryFor, defaultJobOptions, retention, hooks })` is
  the whole thing, and **`handler` is required**: declaring a queue *is* declaring that this process
  processes it. The `Worker` class stays internal (`consumer/worker.ts`), built by `createQueue` and
  never handed out; its claim loop starts with the client and stops on shutdown, so there was never a
  lifecycle method to expose. Two rules hold: a queue is declared **once per process** — a second
  `createQueue` for the same name throws, and every such check runs *before* anything is recorded so a
  rejected call can never half-replace a declaration; and **producing needs no declaration at all**,
  since `addJob` addresses a queue by name and ensures its row, which is how a producer-only tier, the
  dashboard and the CLI all enqueue. Splitting the two calls cost a real bug class: the worker
  captured the queue's options at creation, so a declaration made afterwards was silently ignored.
- **`createQueue` is the only thing that records queue options, and nothing internal calls it.** It is
  a *declaration*, made once per process: the caller states what the queue is, and there is no second
  call to disagree with it. That is only safe because no admin action, pause, read or facade method
  goes through it — `pauseQueue` writes the two pause flags and touches nothing else. Before this rule,
  `pauseQueue` called `createQueue({ name })` with no options and silently wiped the queue's registered
  `defaultJobOptions` and `retention`. If you find yourself reaching for `createQueue` inside the
  library, address the queue by name instead.
- **A method never has a side effect its name doesn't imply.** A read does not write: `getSchedules`
  used to ensure the queue row first, so *asking* about a name brought that queue into existence.
  Reads take no `ensure`; only producing does.
- **Admin clients are headless.** `PortQueueOptions._headless` (set only by `@portqueue/dashboard` and
  `@portqueue/cli`) marks a client that observes and administers a deployment without joining it: it
  declares no queues and writes no queue rows, registers **no instance row** and rejects an
  `instanceKey`, consumes no queue and runs no scheduler/retention/monitor, and defaults `migration`
  to `MANUAL`.
  Document the flag in the API reference and nowhere else — an application never sets it. The visible
  consequence: `QueueInfo.inUse` means "declared in the process that produced this info", so it is
  always false on a headless client, which is why the dashboard does not surface it.
- **`createDashboard` takes a driver, not a `PortQueue`.** It builds and owns its own headless client
  (lazily, on the first request) and exposes `close()`. The dashboard is usually a different process
  from the workers, so riding on their client only ever worked when the two happened to share one.
- **Cron parsing is `cron-parser`'s job, not ours.** `scheduling/cron.ts` is a thin wrapper that
  adds eager `InvalidOptionsError` validation and an epoch-ms `next()`; the syntax we support is
  whatever that package supports (5- and 6-field, ranges, lists, steps, names, `L`/`#`/`W`/`?`).
  Don't hand-roll calendar walking or field parsing again.
- **The public API is for developers only — the dashboard and CLI never widen it.** `PortQueue`
  exposes two internal facades, `pq._dashboard` and `pq._cli`, backed by
  `packages/core/src/dashboard/` and `packages/core/src/cli/`. Those two packages consume **only**
  their own facade plus the documented public methods that already fit their needs unchanged. The
  moment the dashboard or CLI wants something the public surface doesn't already document —
  server-side paging for the queues list, a read-only schedule scan, a shared transaction for a
  batch action, driver access — that method goes on the facade, never on `PortQueue` itself. Facade
  methods may reuse the public ones internally. Two consequences to hold to: a public method's
  signature is never changed to suit `@portqueue/dashboard` or `@portqueue/cli`, and anything on a
  facade is undocumented and unsupported for application code (the `_` prefix says so). If a facade
  method turns out to be genuinely useful to developers, promoting it to the public API is a
  deliberate, separately-documented decision — not a side effect.
- **Named options over positional args** for any method with >1 input; `data` is a named key.
- **Enums, not magic strings** for states, events, steps, capabilities, error codes, engines, instance types.
- **No `any`** in the public surface; generics carry the payload type end-to-end.
- **Results are objects**, never bare ids. A driver method that mutates a row by id returns a **ref**
  (`{ jobId, queueName }` / `{ scheduleId, queueName }`), not a boolean: the caller needs the queue
  name to emit its event and wake the right worker, and reading it back afterwards is a second round
  trip — or, on a single-connection engine, a deadlock.
- **A batch is one statement.** Anything that acts on a set of ids — `addJobs`, `requeueJobs`,
  `cancelJobs`, `removeJobs`, `deleteSchedules`, the dashboard's bulk actions — hands the whole set to
  one driver call. Never loop a single-id method inside a transaction: the cost is linear in the ids
  and one stale id rolls back everything beside it. A batch skips what it refuses (a missing id, an
  `ACTIVE` row) rather than failing. Chunk by `BaseDriver.chunkForBind` so a statement can't exceed
  the engine's bound-parameter limit.
- **A running job is untouchable.** `requeueJob`, `removeJob` and `cancelJob` all refuse an `ACTIVE`
  row and report "nothing done" rather than acting. Re-arming a running job clears its lock, so a
  second worker claims it and the same job runs twice concurrently.
- **Filter, page and count in the database.** No read may fetch a table into the process and filter
  there — that includes free-text search, which is a `LIKE` in SQL across the fields an operator
  triages by. A list's `total` is a `COUNT` over the same predicate, so a page and its total can never
  disagree. Anything unbounded is a bug: every sweep takes a `limit` and loops until a batch comes
  back short.
- **No SQL `JOIN`** anywhere — relationships resolve via separate key-based lookups. Keep the schema **minimal**: few tables, little spread; only split a table out when genuinely necessary. Link rows by a **unique name or key** in preference to a surrogate id + foreign key.
- **The driver owns its SQL dialect.** Core calls an intent-named JS method on the driver (e.g. `upsert`, `getOrCreate`) and the driver emits the best SQL its engine supports: a capable engine (Postgres/PGLite) may use native `INSERT … ON CONFLICT`/`MERGE`, real indexes, unique/check constraints and PKs; a sharded/distributed engine uses the conservative path — a guarded `UPDATE … RETURNING` then `INSERT`, or `SELECT`-then-`INSERT` get-or-create — and declares shard keys (usually the queue name) instead of constraints it can't honour; an engine without `RETURNING` (MySQL) mutates then reads the affected rows back in the same transaction. Core logic never assumes a dialect; every path still enforces every invariant (name uniqueness, idempotency/singleton dedup) in code so behaviour is identical across engines.
- **One standalone driver per engine — duplicate the SQL, share the mechanism.** Every engine
  (Postgres, SQLite, Oracle, MySQL, …) has its **own folder under
  `packages/core/src/drivers/<engine>/` and its own driver class** implementing the `Driver` contract.
  **Every statement string lives in that file**; compatible-looking SQL is copied so an
  engine-specific change can never leak across engines.
  What is shared is `drivers/shared/base-driver.ts` — `BaseDriver`, which every driver extends — and it
  contains **no SQL at all**: row → record mapping (`mapJob`, `mapQueue`, …, and the `JOB_COLUMNS`
  list they pair with), value conversion, id generation, `likePattern`, the affinity scan arithmetic,
  bind-chunking, `runMaybeTx`/`inTx`. That is the same category as `TableName`, the `MigrationRunner`
  and the value objects: mechanism, not dialect. A subclass supplies exactly the four per-engine
  pieces — `execute`, `transaction`, `ph` (placeholder style) and `window` (paging tail).
  The line to hold: if it is a statement, or decides the shape of one, it belongs to the engine. If it
  reads a `Row` by column name or does arithmetic, it belongs to `BaseDriver`. Duplicating the mapping
  cost a real bug — a column added to the schema had to be remembered in five files.
- **The one exception: a flavour of an already-supported engine may extend it.** PGLite *is* Postgres (compiled to WASM), same wire protocol and same dialect, so `PgliteDriver extends PostgresDriver` and keeps only what is genuinely custom: the connection mechanism (`connect`/`disconnect`/`execute`/`transaction`, the `@electric-sql/pglite` client shape), `probe`, its capability set (no LISTEN/NOTIFY, no advisory locks), and its own migration array. The `pglite/` folder, its `PGliteDriverOptions`/client types and its `PGLITE_MIGRATIONS` export all stay in place — the folder is still the whole PGLite surface. Two rules hold: the members a flavour needs from Postgres are `protected` (`execute`, `transaction`, `enabledCapabilities`) and pool/listener state stays private; and **a change to a query in `PostgresDriver` changes PGLite too** — if a tweak is Postgres-only, override it in `PgliteDriver` rather than branching on the engine in the base. This applies to PG-wire flavours only; two engines that merely *look* alike still duplicate.
- **Each driver owns its migrations, authored by hand alongside the driver.** Migrations live at
  `packages/core/src/drivers/<engine>/migrations.ts` as an authored `FlavourMigration[]`
  (version → `statements(names)`), written in that engine's own dialect (types, `IF NOT EXISTS`
  strategy, key and index declarations, etc.) — never generated by diffing and never shared between
  engines. **A migration is identified by its `version` and nothing else**: there is deliberately no
  checksum, because nothing ever compared one and a value written but never read states a guarantee
  the code does not make. `applyMigration` runs the statements *and* records the version in one
  transaction, so a crash between them can't leave an applied-but-unrecorded migration.
  PGLite is the one exception, matching the driver rule above: `PGLITE_MIGRATIONS` is its own array but
  points at the Postgres statement builders (`v1`, … exported from `postgres/migrations.ts`) while the
  DDL is identical; a version that needs to diverge gets a local builder swapped in for that version
  only. The driver exposes them via `readonly migrations` (built with the shared `toMigrationSteps`
  helper); the **single shared `MigrationRunner`** in `drivers/shared/` applies the pending steps.
  There is no central schema JSON. **The schema is currently a single `version: 1`** — pre-publication,
  so there is nothing to upgrade from — but the array, the runner and the version bookkeeping stay
  multi-version by design: a future change **appends** `{ version: 2, … }` with its own statement
  builder and never edits `v1`, which is a frozen record of what has already been applied.
- **Use the keys and indexes the engine has.** Every engine here is capable, so `v1` declares a
  primary key per table and one index per hot access path (the claim query in its exact order, both
  maintenance sweeps, the retention sweep, both dedup lookups, the newest-first page, the due-schedule
  scan). Authored per engine in its own dialect: partial indexes on Postgres/SQLite, inline `KEY`
  clauses on MySQL (no `CREATE INDEX IF NOT EXISTS`), PL/SQL-guarded `CREATE INDEX` on Oracle.
  Nothing beyond the primary keys is a *uniqueness* constraint: idempotency and singleton dedup stay
  enforced in driver code, so behaviour is identical on an engine that could not honour one — and a
  dedup returns the existing job rather than surfacing as a constraint violation.
- **`schema` is honoured, not merely accepted.** `TableNames` gives three name forms and they are not
  interchangeable: `qualified()` is what every query site uses, `bare()` is unqualified, and
  `derived()` names an index or constraint the engine files inside the table's own schema. A driver
  option that is validated and then ignored is worse than no option.
- **Never auto-detect instance identity.** Do not derive an instance id or key from the environment (container id, hostname, cgroup, MAC/IP, k8s env). A lock-owner id is taken from the constructor when provided, else a random per-process token. **Multi-instance mode is opt-in solely via `options.instanceKey`** — nothing else enables it.
- **Every read-then-write runs in a transaction.** A driver method that reads and then writes —
  get-or-create, the dedup-plus-insert pair, the heartbeat's update-then-insert, a claim's
  scan-then-update, any select-then-mutate an engine without `RETURNING` needs — goes through
  `BaseDriver.inTx`, which uses the **client-supplied `tx` when provided and opens the driver's own
  otherwise**. There are **no bare multi-statement sequences**. A *lone* statement needs no explicit
  `BEGIN`: every engine here already runs it in an implicit transaction, so wrapping it would add two
  round trips to the hot path (`extendLock` beats several times per job) and buy nothing.
- **All SQL values are bound parameters**; identifiers are allowlist-validated and quoted.
- **DB clients are optional peer dependencies**, never runtime deps.
- **Small, focused classes**, one concern each; DI per PortQueue instance.

## Layout
- `packages/core` → `@portqueue/core` (engine + drivers).
  - `src/drivers/` — the `Driver` contract, capabilities, `DriverContext`, `TableName`, and every
    per-engine driver + its migrations. `src/drivers/shared/` holds what is genuinely engine-neutral:
    `BaseDriver` (mapping and mechanism, no SQL), the `MigrationRunner`, the migration helpers and the
    retention-status encoding. There is no separate `driver/` or `schema/` folder.
  - `src/constants/` — every default the tool applies, one file per scope. Nothing is inlined at a
    use site.
  - `src/dashboard/` and `src/cli/` — the two internal facades (`pq._dashboard`, `pq._cli`); see the
    invariant above.
- `packages/dashboard` → `@portqueue/dashboard`
  - `src/server/api/routes/` — **one file per route**, plus `routes/actions/` with **one file per
    mutation**. Each exports a self-describing `Route`/`ActionRoute`, and the registry in the folder's
    `index.ts` derives dispatch from the list — the same shape as the CLI's commands, and for the same
    reason: adding an endpoint is adding a file and one line, never extending a conditional chain.
    Shared plumbing sits beside them (`api/http.ts` for the reply helpers, `api/params.ts` for
    query-string parsing, `routes/actions/validate.ts` for field checks).
  - `src/client/`, `src/shared/` — the SPA and the wire DTOs it shares with the server.
- `packages/cli` → `@portqueue/cli`
  - `src/commands/` — **one file per command, with its test beside it**. `commands/index.ts` is the
    registry both dispatch and the generated help are derived from.
- `packages/ui` → `@portqueue/ui` (private, never published)
- `packages/eslint-config` → private shared lint base
- `docs/` → Docusaurus site

## Tooling
- Each workspace owns a standalone `tsconfig.json`, `eslint.config.mjs`, `package.json`. No root `extends`.
- Conventional commits enforced.

## Testing
- Jest + ts-jest. A fresh, clean database per suite; an injectable clock so nothing waits on real time.
- **One test file per unit, beside the unit.** A CLI command's tests live in `commands/<name>.test.ts`,
  a dashboard route's in `routes/<name>.test.ts`, an action's in `routes/actions/<area>.test.ts`. Never
  one file covering a whole folder: a monolith test is the file nobody reads before changing something,
  and the shared fake inside it is the one that quietly drifts from what it is standing in for. Shared
  fakes and harnesses go in the package's `test-support/`.
- **Automated coverage runs on PGLite and SQLite only.** They are in-process, so the whole suite —
  including the conformance kit — runs with no external service. PGLite exercises the Postgres SQL by
  inheritance, so Postgres is covered in practice too.
- **MySQL and Oracle are verified by hand**, by running `runConformance({ createDriver })` against a
  real server (`npm run db:mysql:up` / `npm run db:oracle:up` start one). Their SQL is authored in
  their own dialects and cannot be exercised by an in-process engine, so a change to either driver is
  not done until the kit has been run against it. Say so in the change report when you touch one.
- The conformance kit is the contract, not a smoke test: it pins the guards core depends on
  (`requeueJob`/`removeJob`/`cancelJob` refusing an `ACTIVE` row, bounded expiry and reclaim,
  per-row retention statuses, `advanceSchedule`'s guarded claim, the `search` filter, and agreement
  between every list page and its `count*`). A new driver method needs a case there.
