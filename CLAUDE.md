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
  string. Instants stay `Date` on the public surface. `util/seconds.ts` is the one place seconds meet
  milliseconds — the clock, `setTimeout`/`setInterval` and every stored *instant* are epoch-ms, so a
  duration is multiplied by 1000 exactly once, at that boundary.
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
- **Results are objects**, never bare ids.
- **No SQL `JOIN`** anywhere — relationships resolve via separate key-based lookups. Keep the schema **minimal**: few tables, little spread; only split a table out when genuinely necessary. Link rows by a **unique name or key** in preference to a surrogate id + foreign key.
- **The driver owns its SQL dialect.** Core calls an intent-named JS method on the driver (e.g. `upsert`, `getOrCreate`) and the driver emits the best SQL its engine supports: a capable engine (Postgres/PGLite) may use native `INSERT … ON CONFLICT`/`MERGE`, real indexes, unique/check constraints and PKs; a sharded/distributed engine uses the conservative path — a guarded `UPDATE … RETURNING` then `INSERT`, or `SELECT`-then-`INSERT` get-or-create — and declares shard keys (usually the queue name) instead of constraints it can't honour; an engine without `RETURNING` (MySQL) mutates then reads the affected rows back in the same transaction. Core logic never assumes a dialect; every path still enforces every invariant (name uniqueness, idempotency/singleton dedup) in code so behaviour is identical across engines.
- **One standalone driver per engine — duplicate over sharing across engines.** Every engine (Postgres, SQLite, Oracle, MySQL, …) has its **own folder under `packages/core/src/drivers/<engine>/` and its own self-contained driver class** implementing the `Driver` contract — no shared query-building base class between engines. Compatible-looking SQL is copied into each driver so an engine-specific change can never leak across engines. Only genuinely engine-neutral *mechanism* (the migration runner, the `Driver`/capability/context contract, `TableName`, value objects) lives in a shared spot; dialect and query SQL never do.
- **The one exception: a flavour of an already-supported engine may extend it.** PGLite *is* Postgres (compiled to WASM), same wire protocol and same dialect, so `PgliteDriver extends PostgresDriver` and keeps only what is genuinely custom: the connection mechanism (`connect`/`disconnect`/`execute`/`transaction`, the `@electric-sql/pglite` client shape), `probe`, its capability set (no LISTEN/NOTIFY, no advisory locks), and its own migration array. The `pglite/` folder, its `PGliteDriverOptions`/client types and its `PGLITE_MIGRATIONS` export all stay in place — the folder is still the whole PGLite surface. Two rules hold: the members a flavour needs from Postgres are `protected` (`execute`, `transaction`, `enabledCapabilities`) and pool/listener state stays private; and **a change to a query in `PostgresDriver` changes PGLite too** — if a tweak is Postgres-only, override it in `PgliteDriver` rather than branching on the engine in the base. This applies to PG-wire flavours only; two engines that merely *look* alike still duplicate.
- **Each driver owns its migrations, authored by hand alongside the driver.** Migrations live at `packages/core/src/drivers/<engine>/migrations.ts` as an authored `FlavourMigration[]` (version → checksum → `statements()`), written in that engine's own dialect (types, `IF NOT EXISTS` strategy, shard-key declarations, etc.) — never generated by diffing and never shared between engines. PGLite is the one exception, matching the driver rule above: `PGLITE_MIGRATIONS` is its own array but points at the Postgres statement builders (`v1`, … exported from `postgres/migrations.ts`) while the DDL is identical; a version that needs to diverge gets a local builder swapped in for that version only. The driver exposes them via `readonly migrations` (built with the shared `toMigrationSteps` helper); the **single shared `MigrationRunner`** in `drivers/shared/` applies the pending steps. There is no central schema JSON. **The schema is currently a single `version: 1`** — pre-publication, so there is nothing to upgrade from — but the array, the runner and the version/checksum bookkeeping stay multi-version by design: a future change **appends** `{ version: 2, … }` with its own statement builder and never edits `v1`, which is a frozen record of what has already been applied.
- **Never auto-detect instance identity.** Do not derive an instance id or key from the environment (container id, hostname, cgroup, MAC/IP, k8s env). A lock-owner id is taken from the constructor when provided, else a random per-process token. **Multi-instance mode is opt-in solely via `options.instanceKey`** — nothing else enables it.
- **Everything runs in a transaction.** Every DB operation the tool performs uses a transaction: the **client-supplied `tx` when provided, otherwise the driver's own**. Even a single statement is wrapped when the engine supports transactions (drivers that don't may no-op the wrapper). No bare multi-statement sequences outside a transaction.
- **All SQL values are bound parameters**; identifiers are allowlist-validated and quoted.
- **DB clients are optional peer dependencies**, never runtime deps.
- **Small, focused classes**, one concern each; DI per PortQueue instance.

## Layout
- `packages/core` → `@portqueue/core` (engine + drivers). The `Driver` contract, capabilities, `DriverContext`, `TableName`, the shared `MigrationRunner`/migration helpers, and every per-engine driver + its migrations all live under `src/drivers/` (there is no separate `driver/` or `schema/` folder). `src/dashboard/` and `src/cli/` hold the two internal facades (`pq._dashboard`, `pq._cli`) — see the invariant above.
- `packages/dashboard` → `@portqueue/dashboard`
- `packages/cli` → `@portqueue/cli`
- `packages/ui` → `@portqueue/ui` (private, never published)
- `packages/eslint-config` → private shared lint base
- `docs/` → Docusaurus site

## Tooling
- Each workspace owns a standalone `tsconfig.json`, `eslint.config.mjs`, `package.json`. No root `extends`.
- Tests: Jest + ts-jest, PGLite + SQLite only, fresh clean DB per suite, injectable clock (no real waiting).
- Conventional commits enforced.
