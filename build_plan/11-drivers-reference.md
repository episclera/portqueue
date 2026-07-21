# 11 — Drivers Reference (Postgres, PGLite, SQLite, Oracle + custom)

Per-engine implementation notes. Each driver lives in `packages/core/src/drivers/<engine>/`, implements the `Driver` interface (file 03), declares its DB client as an **optional peer dependency**, and is imported from a subpath (`@portqueue/core/drivers/<engine>`). Shared SQL/logic lives in `drivers/shared/` and `driver/base-driver.ts`.

General rules for every driver:
- **All values are parameterized**; all identifiers (schema, prefix, table, column) are allowlist-validated and quoted by the driver (file 18). No string-concatenated SQL from user input, ever.
- Map native errors into `DriverConnectionError` / `DriverQueryError` (file 10) with `cause` preserved.
- Declare capabilities honestly; `probe()` verifies them at runtime and warns on mismatch.
- Own the row↔`JobRecord` mapping for the engine's storage choices (timestamps, JSON, enums, booleans).

---

## 11.1 Postgres driver (`drivers/postgres`)

- **Client:** `pg` (peer). Accepts either a connection string or a `pg.Pool`/config; also accepts an existing pool so the app can share one.
- **Capabilities:** `LISTEN_NOTIFY`, `SKIP_LOCKED`, `RETURNING`, `DB_GENERATED_UUID` (`gen_random_uuid()` / `pgcrypto`), `TRANSACTIONS`, `ADVISORY_LOCK`, `JSON_NATIVE` (`JSONB`), `UPSERT` (`ON CONFLICT`). Full-feature reference driver.
- **Notify:** dedicated `LISTEN` connection (its own client checked out of the pool, not shared with query traffic). Channel names namespaced by `namespace`/prefix. Payload is a small signal (`{queue}`), size-bounded (Postgres NOTIFY payload limit ~8000 bytes — we send tiny signals only).
- **Claim:** `SELECT ... FOR UPDATE SKIP LOCKED LIMIT n` + update in one statement/CTE (`UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`).
- **Types:** `TIMESTAMPTZ`, native enums (`job_status_enum`, `instance_type_enum`), `JSONB` for `data`/`return_value`/`steps_history`.
- **Transactions:** managed via a checked-out client; `adoptTransaction` accepts a `pg.PoolClient`/`pg.Client` mid-transaction, or a TypeORM/Knex query-runner exposing the underlying client (documented adapters).
- **Advisory lock** used for scheduler/retention/migration leader election (optimization).

## 11.2 PGLite driver (`drivers/pglite`)

- **Client:** `@electric-sql/pglite` (peer) — Postgres compiled to WASM, in-process, file- or memory-backed.
- **Capabilities:** same SQL dialect as Postgres → `SKIP_LOCKED`, `RETURNING`, `JSON_NATIVE`, `UPSERT`, `TRANSACTIONS`, `DB_GENERATED_UUID`. **`LISTEN_NOTIFY`**: PGLite supports Postgres LISTEN/NOTIFY within the single instance — enable if the running version does; otherwise fall back to polling. `probe()` decides. Advisory locks exist but are moot single-process.
- **Concurrency note:** PGLite is single-connection/in-process. It's primarily for **embedded/edge use and for tests** (file 16). Horizontal scaling across processes isn't the point here (one process owns the WASM DB), but the *same code path* works — the claim/lock logic is identical to Postgres; contention is just intra-process.
- **Storage:** identical to Postgres driver; can largely subclass it (share SQL via `drivers/shared` / a `PostgresDialectDriver` base), overriding only connection management and the notify decision. This is a key reuse win — Postgres and PGLite share ~90% of SQL.

## 11.3 SQLite driver (`drivers/sqlite`)

- **Client:** prefer Node's built-in `node:sqlite` (Node 22+/24+) to avoid a native dep; support `better-sqlite3` as an alternative peer. Decide the default in implementation based on the pinned Node LTS; document both. Whichever, it's a peer/optional, never bundled.
- **Capabilities:** `RETURNING` (modern SQLite), `UPSERT` (`ON CONFLICT`), `TRANSACTIONS`. **No** `LISTEN_NOTIFY` → interval polling. **No** `SKIP_LOCKED` → use the atomic-update claim fallback (file 03.5); SQLite's single-writer model makes the guarded `UPDATE ... WHERE state=PENDING ... RETURNING` naturally exclusive. **No** `DB_GENERATED_UUID` → app-generated UUID (`node:crypto`). `JSON_NATIVE`: SQLite has JSON functions but stores as TEXT — treat as **no** native JSON type; store payloads as TEXT and (de)serialize in the driver.
- **Types:** timestamps as integer epoch-ms (chosen for cheap comparisons and index-friendliness; document the choice); booleans as `0/1`; enums as `TEXT` + `CHECK` constraints.
- **Concurrency:** enable WAL mode; set a `busy_timeout`. Single-writer means claiming is simple and correct; multiple *processes* sharing one SQLite file works but is throughput-limited — document that SQLite is best for single-instance or low-throughput deployments, and point higher-scale users to Postgres.
- Primary role: **the other test driver** (file 16) and small single-node deployments.

## 11.4 Oracle driver (`drivers/oracle`)

- **Client:** `oracledb` (peer).
- **Capabilities:** `SKIP_LOCKED` (`FOR UPDATE SKIP LOCKED`), `RETURNING` (`RETURNING ... INTO`), `TRANSACTIONS`, `UPSERT` (`MERGE`), `DB_GENERATED_UUID` (`SYS_GUID()` — note: RAW(16)/GUID, map to canonical UUID text in the driver), `JSON_NATIVE` (native `JSON` type on 21c+, else `CLOB` + `IS JSON`). **`LISTEN_NOTIFY`:** Oracle offers `DBMS_ALERT` and Continuous Query Notification (CQN) — support via CQN where the account has privileges; otherwise fall back to polling (`probe()` detects privilege). Advisory-lock analog: `DBMS_LOCK`.
- **Types:** `TIMESTAMP WITH TIME ZONE`; enums as `VARCHAR2` + `CHECK`; identifiers upper-cased per Oracle norms (handle quoting/case explicitly).
- **Gotchas to handle:** bind-variable style (`:1`/named binds), `RETURNING INTO` out-binds, GUID↔UUID conversion, and the 30-byte (or 128 on 12.2+) identifier length limit — validate that `prefix + table` fits and error early with a clear message if not.

---

## 11.5 Shared implementation strategy (reuse)

- `driver/base-driver.ts` — engine-neutral: row↔record mapping scaffolding, migration bookkeeping, default retention batching, capability-defaulting, identifier validation/quoting hooks.
- `drivers/shared/` — a **SQL-dialect base** (`SqlDriver`) with parameter-binding abstraction and the common statements (claim, complete, retry, insert) templated so Postgres/PGLite/Oracle/SQLite override only dialect specifics (placeholder style, `SKIP LOCKED` availability, `RETURNING` syntax, JSON handling). Postgres and PGLite share the most; Oracle overrides binds and MERGE; SQLite overrides claim (fallback) and type mapping.
- This keeps each concrete driver small and focused, per the "reuse as much as possible / small classes" rule.

## 11.6 Peer-dependency policy (restated, critical)

- Every DB client is `peerDependencies` + `peerDependenciesMeta.optional = true`. Installing `@portqueue/core` pulls **none** of them.
- Importing `@portqueue/core/drivers/postgres` requires the app to have `pg` installed; if missing, the driver throws a clear `INVALID_OPTIONS`/load-time error: *"The Postgres driver requires the 'pg' package. Install it with `npm install pg`."*
- Docs installation tabs (file 15) show, per driver, the exact `npm install @portqueue/core <client>` command.

## 11.7 Local final-check checklist

- [ ] Each driver honestly declares capabilities; `probe()` verifies and warns on mismatch.
- [ ] Postgres + PGLite share a dialect base; Oracle/SQLite override only what differs — minimal duplication.
- [ ] SQLite/PGLite paths are the ones exercised by tests and behave identically to Postgres at the API level.
- [ ] All DB clients are optional peers; a missing client yields a clear install-me error, never a cryptic crash.
- [ ] Identifier length/case/quoting handled per engine (esp. Oracle); early clear error if prefix+table too long.
- [ ] Every engine's claim path is atomic and crash-safe (SKIP LOCKED or guarded update).
