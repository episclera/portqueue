# 20 — Roadmap & Future-Proofing

Deferred features and — more importantly — **how today's interfaces are shaped so these can land later without breaking app code.** The v1 API is designed to make these additive, not breaking.

## 20.1 Worker threads / out-of-process execution (explicitly deferred)

- **v1:** handlers run on the main event loop (file 02.6). No worker threads.
- **How v1 leaves room:** execution is isolated behind an internal **`Executor` strategy** inside `ExecutionService`, and the `Job` context passed to handlers is a plain serializable-friendly view + control methods routed through the worker (not direct DB handles). A future `ThreadExecutor` (Node `worker_threads`) or `ProcessExecutor` can run the handler off-thread and marshal results back, selected via a future `WorkerOptions.executor` option that **defaults to the in-process one** — so existing code keeps working unchanged.
- Constraints to preserve now: don't hand handlers non-serializable live objects (DB connections, the raw driver) in the public `Job` type; keep handler input/output JSON-serializable-friendly; keep `job.log`/`extendLock`/step control as message-able operations. This is already the v1 shape.

## 20.2 More first-party drivers

- Candidates: MySQL/MariaDB, CockroachDB, MSSQL, MongoDB (document engine — would exercise the non-SQL side of the driver abstraction), and a Redis driver (for teams that do have Redis and want the same API).
- The `Driver` interface + capability model (file 03) already supports this; each is a new `packages/core/src/drivers/<engine>/` with an optional peer client and a conformance-kit pass. MongoDB would validate that the abstraction isn't secretly SQL-only (it should lean on capabilities like `SKIP_LOCKED` being false and using findAndModify-style atomic claims).

## 20.3 Flows / job dependencies (parent-child)

- BullMQ-style flows (a parent job that waits for children). Multi-step (file 06) covers many sequential cases already; true fan-out/fan-in dependency graphs are a future addition. Design note: model as a `parent_job_id` + a dependency-count column on the `job` table so it stays join-free and instance-agnostic.

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
- Any engine that needed a 5th physical table beyond the archive (file 04.6) is logged here with why.
- The `@portqueue/ui` publish-vs-bundle decision (file 14.3) is recorded here once made.
