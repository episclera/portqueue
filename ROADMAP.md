# PortQueue Roadmap

PortQueue's v1 API is designed so that everything below can land **additively** —
as new optional options with safe defaults, new enum members, or new packages —
**without breaking existing app code.** This document tracks what's deferred, how
today's interfaces already leave room for it, and the decisions we may revisit.

> **Guiding rule:** if a feature would require changing an existing method's
> signature or repurposing an existing enum value, it's designed wrong. The
> named-options API makes adding options non-breaking by construction.

## Status legend

- 🔭 **Planned** — intended, shape already accounted for in v1.
- 🧪 **Exploring** — likely, but the design is still open.
- 💤 **Deferred** — deliberately out of scope for v1.

---

## Execution locality (instance affinity) ✅ / 🔭

**Shipped in v1.** Opt in with an `instanceKey` on the `PortQueue` constructor (multi-instance
mode). Jobs can be pinned with `preferredInstanceKey` / `preferredInstanceKeyPattern` (a regex)
and a liveness-aware `fallbackInstanceKey` / `fallbackInstanceKeyPattern`, so nothing strands on a
dead node. Delivered together:

- an **instance-liveness subsystem** — an `instance` table (`instance_key`, `processing_paused`,
  `last_seen_at`, timestamps) with a per-instance heartbeat;
- a **claim-time affinity filter** — evaluated in-tool (portable regex + liveness) in `claimJobs`,
  covered by the conformance kit;
- **per-instance pause/resume** and an **Instances dashboard page** with live attribution
  (`processed_on_instance_key`).

See the [multi-instance guide](./docs/docs/guides/multi-instance.md).

**Still planned 🔭.** Two ergonomic defaults on top of the primitives above:

- **Workflows — default *same machine*.** Steps carry affinity forward today; a future
  `execution: 'same-machine' | 'distributed'` would auto-pin an unpinned run to the instance that
  ran its first step.
- **Schedules — default *distributed*.** An opt-in "prefer the first-run machine if it's still
  alive" mode for cache/warm-path affinity.

---

## Execution model

### Worker threads / out-of-process execution 💤

In v1, handlers run on the main event loop — no worker threads.

**How v1 leaves room:** execution is isolated behind an internal `Executor`
strategy inside the execution service, and the `Job` context passed to handlers
is a serializable-friendly view plus control methods routed through the worker
(not direct DB handles). A future `ThreadExecutor` (Node `worker_threads`) or
`ProcessExecutor` can run the handler off-thread and marshal results back,
selected via a future `WorkerOptions.executor` option that **defaults to the
in-process executor** — so existing code keeps working unchanged.

Constraints already honored in v1 to keep this additive: the public `Job` type
never exposes non-serializable live objects (DB connections, the raw driver);
handler input/output stays JSON-serializable-friendly; and `extendLock` / step
control are expressed as message-able operations.

### Delivery-guarantee options 🔭

v1 is **at-least-once**. A future opt-in "at-most-once for non-critical jobs"
(ack-before-run) could be offered per queue for workloads that prefer dropping
over duplicating — an additive `QueueOptions` flag, off by default.

---

## Drivers

### More first-party drivers 🔭

Candidates: MySQL / MariaDB, CockroachDB, MSSQL, MongoDB, and a Redis driver
(for teams that already run Redis and want the same API).

The `Driver` interface and capability model already support this: each new
driver is a `packages/core/src/drivers/<engine>/` directory with an optional
peer client and a conformance-kit pass. MongoDB is the interesting stress test —
it validates that the abstraction isn't secretly SQL-only, leaning on
capabilities like `SKIP_LOCKED = false` and `findAndModify`-style atomic claims.

---

## Scheduling & scaling

### Flows / job dependencies (parent-child) 🧪

BullMQ-style flows — a parent job that waits for its children. Workflows already
cover many sequential cases, and because each step is its own job row sharing a
`workflow_id`, fan-out/fan-in is a natural extension. Design note: add a
`parent_job_id` and a dependency-count column (reusing the existing `workflow_id`
grouping) so it stays join-free and instance-agnostic.

### Multi-queue worker (poll-storm relief) 🔭

A worker binds to one queue today, so consuming many queues means many claim
loops. A future multi-queue worker would run a single claim loop across a
configured set of queues — one heartbeat, one poller, fair round-robin / priority
across queues — cutting DB round-trips for consumers of many low-traffic queues.
Additive: the single-queue form stays the default.

### Priority fairness / anti-starvation 🔭

An optional `maxPriorityStarvationMs` to age low-priority jobs upward, so a flood
of high-priority work can't starve them indefinitely. Additive worker/queue
option.

### Distributed scheduler leadership 🧪

v1 coordinates scheduling and retention via a claim / advisory-lock per tick
(correct and simple). A future explicit leader-election (using the
`ADVISORY_LOCK` capability) could reduce redundant tick work at very large
instance counts — an optimization, not a correctness change.

---

## Observability & tooling

### Richer metrics / tracing integration 🔭

v1 exposes events and DB stats while staying dependency-free. A future optional
`@portqueue/otel` package could ship an OpenTelemetry bridge (spans per job,
metrics) as opt-in, without adding dependencies to core.

### Dashboard enhancements 🔭

Job payload search / indexing, saved filters, per-user roles beyond
read-only/full, retry-with-modified-payload, and historical analytics
(throughput trends, latency percentiles). All build on the existing read APIs and
`run_on_instance_*` attribution.

---

## Principles for all future work

- **Additive, not breaking.** New capabilities arrive as new optional options
  with safe defaults, new enum members, or new packages — never by changing an
  existing method's signature or repurposing an existing enum value.
- **Capability-gated.** Anything a driver can't do is a capability flag with a
  documented fallback or a typed `UnsupportedCapabilityError` — the public method
  still exists on every driver.

---

## Decisions & recorded deviations

Accepted exceptions to the design invariants are logged here with justification,
so they're revisited deliberately rather than forgotten:

- Any accepted exception to "zero runtime deps" (e.g. pulling in a cron parser or
  CLI arg parser).
- If the per-instance DI scoping proves too awkward, the switch to a hand-rolled
  constructor-injection container (public API unaffected).
- Any engine that needed a physical table beyond the four logical tables.
- The `@portqueue/ui` publish-vs-bundle question is **settled**: `private: true`,
  never published, bundled into the docs site and dashboard. Revisit only if an
  external runtime consumer ever needs it.

### Deviations taken by the initial implementation (v0.1.0)

Concrete deviations made while first building PortQueue; each keeps the public API
and logical data model intact.

1. **Hand-rolled DI instead of typedi.** typedi's per-instance
   `Container.of(scopeId)` scoping is a documented sharp edge and pulls in
   `reflect-metadata` plus decorator build config. Per the sanctioned fallback,
   services use plain constructor injection wired in a per-`PortQueue` `Runtime`
   object (`src/client/runtime.ts`). Each `PortQueue` gets its own service graph;
   no global container; public API unaffected; zero added runtime deps.
2. **Uniform physical storage across engines.** For portability, all
   timestamps/durations are stored as `BIGINT` epoch-ms, JSON columns as `TEXT`,
   and booleans as small integers `0/1` on **every** engine (rather than Postgres
   `TIMESTAMPTZ` / `JSONB` / native enums). `BIGINT` is required so epoch-ms
   doesn't overflow Postgres' 32-bit `INTEGER`; SQLite treats it as its native
   64-bit integer. The logical four-table model, column set, indexes, and public
   API are exactly as specified. Native `JSONB`/enum/timestamptz storage can be
   reintroduced per-driver later without an API change.
3. **`schema` qualification validated but not applied on the test engines.**
   `schema` / `tablePrefix` are allowlist-validated at construction; table names
   use the prefix. Schema-qualified names are a per-driver concern reintroduced
   when needed (Postgres/Oracle); SQLite has no schemas.
4. **DB-generated UUIDs disabled (`DB_GENERATED_UUID = false` everywhere).**
   UUIDs are app-generated via `node:crypto` uniformly, simplifying the insert
   path across engines. The capability flag remains so a driver may opt in later.
5. **Oracle driver is structurally implemented, not CI-tested.** Connection and
   dialect wiring (`:1` binds, MERGE-capable dialect base) is in place; it is
   validated by the conformance kit against a real Oracle server rather than in
   CI. `RETURNING INTO` out-binds and GUID mapping are the follow-up items for
   full Oracle parity.
6. **Build tool naming.** Vite library mode uses `lib.fileName` (not
   `output.entryFileNames`) to emit reliable `index.mjs` / `index.cjs` entries
   for the multi-entry driver subpaths.
