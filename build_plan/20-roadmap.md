# 20 — Roadmap & Future-Proofing

Deferred features and — more importantly — **how today's interfaces are shaped so these can land later without breaking app code.** The v1 API is designed to make these additive, not breaking.

## 20.1 Worker threads / out-of-process execution (explicitly deferred)

- **v1:** handlers run on the main event loop (file 02.6). No worker threads.
- **How v1 leaves room:** execution is isolated behind an internal **`Executor` strategy** inside `ExecutionService`, and the `Job` context passed to handlers is a plain serializable-friendly view + control methods routed through the worker (not direct DB handles). A future `ThreadExecutor` (Node `worker_threads`) or `ProcessExecutor` can run the handler off-thread and marshal results back, selected via a future `WorkerOptions.executor` option that **defaults to the in-process one** — so existing code keeps working unchanged.
- Constraints to preserve now: don't hand handlers non-serializable live objects (DB connections, the raw driver) in the public `Job` type; keep handler input/output JSON-serializable-friendly; keep `extendLock`/step control as message-able operations. This is already the v1 shape.

## 20.2 More first-party drivers

- Candidates: MySQL/MariaDB, CockroachDB, MSSQL, MongoDB (document engine — would exercise the non-SQL side of the driver abstraction), and a Redis driver (for teams that do have Redis and want the same API).
- The `Driver` interface + capability model (file 03) already supports this; each is a new `packages/core/src/drivers/<engine>/` with an optional peer client and a conformance-kit pass. MongoDB would validate that the abstraction isn't secretly SQL-only (it should lean on capabilities like `SKIP_LOCKED` being false and using findAndModify-style atomic claims).

## 20.3 Flows / job dependencies (parent-child)

- BullMQ-style flows (a parent job that waits for children). **Workflows** (file 06) cover many sequential cases already — and because each step is already its own `job` row sharing a `workflow_id`, fan-out/fan-in is a natural extension. Design note: add a `parent_job_id` + a dependency-count column on the `job` table (reusing the existing `workflow_id` grouping) so it stays join-free and instance-agnostic.

## 20.4 Priority fairness / anti-starvation

- Optional `maxPriorityStarvationMs` (file 07.7) to age low-priority jobs upward so a flood of high-priority work can't starve them indefinitely. Additive worker/queue option.

## 20.4b Multi-queue worker (poll-storm relief)

- A `Worker` is bound to one queue today, so consuming many queues means many claim loops/pollers (file 07.7b). A future multi-queue worker would run a single claim loop across a configured set of queues (one heartbeat, one poller, fair round-robin/priority across queues), cutting DB round-trips for consumers of many low-traffic queues. Additive: the single-queue form remains the default.

## 20.5 Richer metrics/tracing integration

- v1 exposes events + DB stats and stays dependency-free. A future optional `@portqueue/otel` package could ship an OpenTelemetry bridge (spans per job, metrics) as opt-in, without adding deps to core.

## 20.6 Dashboard enhancements

- Job payload search/indexing, saved filters, per-user roles beyond read-only/full, retry-with-modified-payload, and historical analytics (throughput trends, latency percentiles). All build on the existing read APIs + `run_on_instance_*` attribution.

## 20.7 Distributed scheduler leadership

- v1 coordinates scheduling/retention via claim/advisory-lock per tick (correct, simple). A future explicit leader-election (using `ADVISORY_LOCK`) could reduce redundant tick work at very large instance counts — an optimization, not a correctness change.

## 20.8 Delivery-guarantee options

- v1 is at-least-once (file 06.2). A future opt-in "at-most-once for non-critical jobs" (ack-before-run) could be offered per queue for workloads that prefer dropping over duplicating — additive `QueueOptions` flag, off by default.

## 20.9 Rule for all future work

- **Additive, not breaking.** New capabilities arrive as new optional options with safe defaults, new enum members, or new packages — never by changing an existing method's signature (the named-options design makes adding options non-breaking by construction) or repurposing an existing enum value.
- **Capability-gated.** Anything a driver can't do is a capability flag with a documented fallback or a typed `UnsupportedCapabilityError` — the public method still exists.

## 20.10 Recorded deviations / decisions to revisit

- Any accepted exception to "zero runtime deps" (file 01.7) is logged here with justification (e.g. if a cron parser or CLI arg parser is pulled in).
- If typedi's per-instance scoping (file 02.1) proves too awkward, the switch to a hand-rolled constructor-injection container is recorded here (public API unaffected).
- Any engine that needed a physical table beyond the four logical tables (file 04.1) is logged here with why.
- The `@portqueue/ui` publish-vs-bundle question is **settled**: `private: true`, never published, bundled into docs + dashboard (file 14.3). Revisit only if an external runtime consumer ever needs it.

### Deviations taken by the initial implementation (v0.1.0)

These are the concrete deviations made while first building the plan; each keeps the public API and logical model intact.

1. **Hand-rolled DI instead of typedi (file 02.1).** typedi's per-instance `Container.of(scopeId)` scoping is a documented sharp edge and pulls in `reflect-metadata` + decorator build config. Per the plan's own sanctioned fallback, services use plain constructor injection wired in a per-`PortQueue` `Runtime` object (`src/client/runtime.ts`). Each `PortQueue` gets its own service graph; no global container; public API unaffected. Zero added runtime deps (a net win for file 01.7).
2. **Uniform physical storage across engines (file 04.6).** For portability and to keep the PG-family and SQLite dialects ~identical, all timestamps/durations are stored as `BIGINT` epoch-ms, JSON columns as `TEXT`, and booleans as small integers `0/1` on **every** engine (rather than Postgres `TIMESTAMPTZ`/`JSONB`/native enums). `BIGINT` is required so epoch-ms doesn't overflow Postgres' 32-bit `INTEGER`; SQLite treats it as its native 64-bit integer. The **logical** four-table model, column set, indexes, and public API are exactly as specified. Native `JSONB`/enum/timestamptz storage can be reintroduced per-driver later without an API change.
3. **`schema` qualification validated but not applied on the test engines.** `schema`/`tablePrefix` are allowlist-validated at construction (file 18.1); table names use the prefix. Schema-qualified names are a per-driver concern reintroduced when needed (Postgres/Oracle); SQLite has no schemas.
4. **DB-generated UUIDs disabled (`DB_GENERATED_UUID` = false everywhere).** UUIDs are app-generated via `node:crypto` uniformly, simplifying the insert path across engines. The capability flag remains so a driver may opt in later.
5. **Oracle driver is structurally implemented, not CI-tested (file 16.1).** Connection/dialect wiring (`:1` binds, MERGE-capable dialect base) is in place; it is validated by the conformance kit against a real Oracle server rather than in CI, exactly as the plan scopes. `RETURNING INTO` out-binds/GUID mapping are the follow-up items for full Oracle parity.
6. **Build tool naming.** Vite library mode uses `lib.fileName` (not `output.entryFileNames`) to emit reliable `index.mjs`/`index.cjs` entries for the multi-entry driver subpaths.
7. **DI container (typedi) → see #1.** No `reflect-metadata`, no decorators; keeps the strict-TS build clean.

