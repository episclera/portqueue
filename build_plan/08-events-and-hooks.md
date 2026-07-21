# 08 — Events & Hooks

PortQueue is event-driven. Two distinct mechanisms, deliberately separated:

- **Events** — *observation*. Fire-and-forget notifications of things that happened. Listeners can't change the outcome. Backed by a typed emitter.
- **Hooks** — *participation*. Registered functions that run at defined points and *can* affect the flow (mutate the outgoing job options, veto/annotate, run side effects the developer wants to await). This is what the raw plan means by "before/after publishing, before/after processing, allow the dev to run custom code."

All event names and phases are **enums**, never magic strings.

## 08.1 `PortQueueEvent` (client/global events)

Emitted on the `PortQueue` instance (`pq.on(PortQueueEvent.X, listener)`). Every listener receives one typed payload object (named fields, no positional args).

Lifecycle / client:
- `CLIENT_STARTED`, `CLIENT_STOPPING`, `CLIENT_STOPPED`
- `MIGRATION_APPLIED` (`{ from, to }`)
- `ERROR` (`{ error, source }`) — any swallowed internal error surfaces here so nothing is truly silent.

Job lifecycle (generic — fire for every queue):
- `JOB_ADDED` (`{ jobId, queue, deduplicated }`)
- `JOB_ACTIVE` (`{ jobId, queue, retryAttempt, instanceId }`)
- `JOB_COMPLETED` (`{ jobId, queue, returnValue, durationMs }`)
- `JOB_FAILED` (`{ jobId, queue, error, retryAttempt, deadLetter }`)
- `JOB_RETRYING` (`{ jobId, queue, retryAttempt, nextRunAt }`)
- `JOB_STALLED` (`{ jobId, queue, previousInstanceId }`)
- `JOB_EXPIRED`, `JOB_CANCELLED`, `JOB_REMOVED`
- `JOB_STEP_COMPLETED` (`{ jobId, queue, step, nextStep }`)

Scheduling:
- `SCHEDULE_CREATED`, `SCHEDULE_UPDATED`, `SCHEDULE_REMOVED`, `SCHEDULE_FIRED` (`{ scheduleId, jobId }`)

Queue control & system:
- `QUEUE_PAUSED`, `QUEUE_RESUMED`
- `WORKER_STARTED`, `WORKER_STOPPED`
- `SYSTEM_PRESSURE_HIGH`, `SYSTEM_PRESSURE_NORMAL`

## 08.2 Specific vs generic events

The raw plan wants "both generic and specific" events. Support both without duplicating enums:

- **Generic:** `pq.on(PortQueueEvent.JOB_COMPLETED, cb)` — fires for all queues; payload includes `queue`.
- **Queue-specific:** `pq.on(PortQueueEvent.JOB_COMPLETED, cb, { queue: 'emails' })` — the emitter filters by the optional `{ queue }` selector so a listener can scope to one queue without a separate enum per queue. (Filtering happens in the bus; the enum stays small and importable.)
- **Worker-scoped:** a `Worker` re-emits the subset relevant to its own queue via `WorkerEvent` (`STARTED | STOPPED | ACTIVE | COMPLETED | FAILED | RETRYING | STALLED | ERROR`) so `worker.on(WorkerEvent.COMPLETED, cb)` reads naturally for consumer code. (`WorkerEvent.STARTED/STOPPED` are the worker-local mirror of the global `WORKER_STARTED/WORKER_STOPPED`; there is no `DRAINED` member — "drained" is not a modeled concept in v1.)

## 08.3 The event bus

`EventBusService` (file 02):
- A typed emitter (built on `node:events` or a tiny typed wrapper — no dependency) mapping each enum member to its payload type, so `on`/`emit` are fully type-checked (`pq.on(JOB_FAILED, cb)` gives `cb` the `JobFailedPayload`).
- **Listener errors are isolated:** a throwing listener is caught, logged, and re-surfaced as `PortQueueEvent.ERROR`; it never breaks emission to other listeners or the job loop (fault-tolerance rule).
- Emission is synchronous fan-out but listeners may be async; the bus does not await them (observation must not block the hot path). Hooks are the mechanism when you need to *await* (08.4).
- `on` returns an `Unsubscribe` function; `once`/`off` provided.

## 08.4 Hooks (participation)

Registered via `pq.useHook({...})` (or `QueueOptions.hooks` for queue-scoped). A hook is awaited at its phase, and can influence the flow. Hook phases (`HookPhase` enum):

- `BEFORE_ADD` — receives `{ queue, options }`; may return modified `JobOptions`/`data` (e.g. inject `metadata`, enforce a tenant `idempotencyKey`) or throw to veto the add. Runs inside the same transaction as the insert when `tx` is used.
- `AFTER_ADD` — receives `{ result }`; side effects (audit, metrics).
- `BEFORE_PROCESS` — receives `{ job }`; may enrich context or throw to skip/fail the job before the handler runs. Runs on the claiming instance.
- `AFTER_PROCESS` — receives `{ job, outcome }` where outcome is complete/failed/retry; side effects (metrics, tracing spans).

Rules:
- Hooks are **awaited** and run in registration order. A hook that throws in a `BEFORE_*` phase aborts that operation with a clear error; a throw in an `AFTER_*` phase is logged and surfaced via `ERROR` but does not undo the completed operation.
- Hooks are the sanctioned place for the developer's custom code around publish/process (the raw plan's explicit ask). Events are for passive observation; hooks are for participation.
- Keep hook payloads typed; no `any`.

## 08.5 Relationship to the dashboard/CLI

- The dashboard's live view and the CLI's `--watch`/infinite-listen mode subscribe to `PortQueueEvent` streams to update in near-real-time (files 12–13).
- Because events can be missed under load or across process boundaries, the dashboard/CLI also periodically reconcile against the DB via the read APIs — events accelerate the UI, the DB is the truth.

## 08.6 Local final-check checklist

- [ ] Every event and hook phase is an exported enum; payloads are typed (no `any`).
- [ ] Generic, queue-filtered, and worker-scoped subscription all work off the same enums.
- [ ] Listener errors are isolated and re-surfaced as `ERROR`; they never break the loop.
- [ ] Hooks are awaited, ordered, can modify `BEFORE_ADD`/`BEFORE_PROCESS` and veto by throwing.
- [ ] Observation (events, non-blocking) and participation (hooks, awaited) are clearly separated in code and docs.
