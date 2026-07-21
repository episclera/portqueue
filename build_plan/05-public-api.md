# 05 — Public API (the developer-facing interface)

This is the contract developers touch. It must be the cleanest part of the whole project. Rules restated and **binding**:

- **No positional parameters** where a method takes more than one input — one named-options object.
- **Enums, not strings** for states, events, steps, capabilities, error codes, engines, instance types.
- **Strict types, no `any`.** The payload type flows through generics end-to-end.
- **Results are objects**, never bare ids.
- **Producer / queue / worker option types are separate** and never mixed.
- **Job-level options override queue-level.**

Everything below is exported from `@portqueue/core`'s barrel (`src/index.ts`). Drivers are imported from subpaths.

## 05.1 The three objects and how they relate

- **`PortQueue`** — the client. One per database. Owns connection, migration, shared services. Produces `Queue` and `Worker` handles.
- **`Queue`** — the **producer** handle for one named queue: add/schedule/inspect/control jobs. Getting a `Queue` does no I/O beyond lazily ensuring the queue is registered.
- **`Worker`** — the **consumer** for one named queue: claims jobs and runs handlers. Created separately so producing and consuming can live on different servers (the "send here, process there" deployment).

**The usual order on a full worker instance is: (1) create the `Queue` handle, (2) register the `Worker`, (3) `addJob`.** A worker begins claiming automatically once `pq.init()` has run and the queue isn't paused — workers have no lifecycle methods of their own (05.4).

```
enum QueueName { Emails = 'emails' }       // the app's catalogue of queue names

const pq = new PortQueue<QueueName>({ driver: new PostgresDriver({ ... }) });
await pq.init();

// 1) queue handle (producer) — name is checked against QueueName
const emails = pq.createQueue(QueueName.Emails);

// 2) worker (consumer) — registering it is enough; it starts claiming automatically
pq.createWorker({
  queue: QueueName.Emails,
  concurrency: 10,
  handler: async (job) => { await send(job.data); },
});

// 3) add a job
await emails.addJob({ data: { to: 'a@b.com' } });
```

**Worker-less (producer-only) servers.** You do **not** have to define a `Worker` to add jobs. A server whose only role is to *enqueue* work — e.g. an API tier — just creates the `Queue` handle and calls `addJob`; it never calls `createWorker`. The jobs it adds are picked up and handled by **whatever other instances did define a worker** for that queue (the "send here, process there" deployment). Because every instance is built from the same `PortQueue` config, the producer-only tier and the worker tier agree on the queue without any extra coordination:

```
// api-server.ts — producer only, no worker defined here
const pq = new PortQueue({ driver: new PostgresDriver({ ... }) });
await pq.init();
await pq.createQueue('emails').addJob({ data: { to: 'a@b.com' } });
// → handled by the worker tier (worker.ts), not this process
```

Ordering within one process is otherwise flexible (the queue row is ensured lazily and jobs sit `PENDING` until *some* instance's worker claims them), but defining the worker before you start adding on a full worker instance means it begins draining immediately rather than after a first backlog builds.

## 05.2 `PortQueue<TQueues extends string = string>`

### Construction — `new PortQueue<TQueues>(options: PortQueueOptions)`

**Queue-name type safety (opt-in via the `TQueues` generic).** `PortQueue` takes an optional type parameter — a **string enum (or string-literal union) of the queue names this app uses** — and threads it through every queue-name argument. Define one enum and pass it once:

```ts
enum QueueName { Emails = 'emails', Payments = 'payments', Orders = 'orders' }

const pq = new PortQueue<QueueName>({ driver: new PostgresDriver({ ... }) });

pq.createQueue(QueueName.Emails);                 // ✅ typed to the enum
pq.createWorker({ queue: QueueName.Orders, handler });
pq.createQueue('typo');                           // ❌ compile error — not a QueueName
```

Every method that names a queue — `createQueue`, `createWorker`, `pauseQueue`/`resumeQueue`, `getQueueStats`, `getJobs`, and the `{ queue }` event filter — accepts **only `TQueues`**, so a mistyped or retired queue name is a compile-time error and the enum is the single catalogue of valid queues. `TQueues` **defaults to `string`**, so passing no generic keeps everything working with plain strings (back-compatible); passing the enum is the recommended, type-safe path and is what the docs/examples show. The generic constrains *names* only — the per-job payload type is still the separate `TData` generic on `createQueue`/`createWorker`.

`PortQueueOptions`:
- `driver: Driver` — a driver instance (from a subpath import or a custom one). **Required.**
- `logger?: Logger | LoggerOptions` — inject a logger or configure the built-in (file 10).
- `schema?: string` — DB schema/namespace.
- `tablePrefix?: string` — default `'pq_'`.
- `migration?: MigrationMode` — enum `AUTO | MANUAL | VALIDATE_ONLY`, default `AUTO`.
- `defaultJobOptions?: JobOptions` — client-wide job defaults (lowest precedence; queue and job override).
- `monitor?: SystemMonitorOptions | false` — system-pressure backpressure (file 07); `false` disables.
- `retention?: RetentionOptions` — client-wide default retention (file 06).
- `maxPayloadBytes?: number` — reject `addJob` when the serialized `data` exceeds this, with a clear error (file 18); default e.g. 1 MiB. Overridable per queue.
- `instance?: InstanceIdentityOptions` — override auto-detected instance id/type (file 07).
- `namespace?: string` — logical prefix for pub/sub channels when multiple PortQueues share one DB.

Construction wires DI only — **no connection, no I/O**.

### Lifecycle
- `init(): Promise<void>` — connect, migrate, start services (file 02.4). Idempotent; safe to await once.
- `shutdown(options?: ShutdownOptions): Promise<void>` — `ShutdownOptions { graceful?: boolean (default true); timeoutMs?: number; drain?: boolean }`. Graceful teardown (file 07).
- `get isRunning(): boolean`.

### Handles
- `createQueue<TData = unknown>(nameOrWorkflow: TQueues | WorkflowDefinition<TData, TQueues>, options?: QueueOptions): Queue<TData>` — get/define a producer. Pass a **name** (constrained to `TQueues`) for a simple queue, or a **`WorkflowDefinition`** (from `defineWorkflow`, whose `queue` is also `TQueues`) for a workflow queue — that's the *only* difference on the producer side: `addJob` is identical for both (05.3). Registers the queue lazily (`ensureQueue`), which only ensures the row exists (name + default-unpaused). All `options` (defaults, rate limit, retention) — and, for a workflow, the step keys/order — are held **in-memory** on the instance; nothing but the pause flags is ever written to the `queue` table (file 04.3).
- `createWorker<TData = unknown, TResult = unknown>(options: WorkerOptions<TData, TResult, TQueues>): Worker<TData, TResult>` — its `queue` is constrained to `TQueues`.

### Cross-cutting reads (used by dashboard/CLI and available to devs)
- `getQueues(): Promise<QueueInfo[]>`.
- `getQueueStats(options?: { queue?: TQueues }): Promise<QueueStats>` — counts by state, throughput, failure rate.
- `getJob<TData>(options: { jobId: string }): Promise<JobSnapshot<TData> | null>`.
- `getJobs<TData>(options: GetJobsQuery): Promise<Page<JobSnapshot<TData>>>` — `GetJobsQuery { queue?: TQueues; statuses?: JobStatus[]; scheduleId?; workflowId?; limit?; cursor?; order? }` (cursor-based paging for the dashboard).
- `getWorkflow(options: { workflowId: string }): Promise<WorkflowSnapshot | null>` — a whole workflow run's steps as an ordered list of `JobSnapshot`s (05.3).

### Global events & hooks (file 08)
- `on(event: PortQueueEvent, listener, filter?: { queue?: TQueues }): Unsubscribe` / `off(...)` / `once(...)` — the optional queue filter is also constrained to `TQueues`.
- `useHook(hook: HookRegistration): Unsubscribe` — register participation hooks (before/after add, before/after process).

### Direct control (convenience; also on `Queue`)
- `pauseQueue(options: { queue: TQueues; mode?: PauseMode }): Promise<void>` / `resumeQueue(options: { queue: TQueues })`.

## 05.3 `Queue<TData>` — the producer

Bound to one queue name.

### Adding jobs (one-off **and** recurring — one method)
- `addJob(options: AddJobOptions<TData>): Promise<AddJobResult>` — enqueue a job. Passing a `schedule` makes it a **recurring** producer instead of a one-off; there is **no separate `schedule()` method**.
- `addJobs(options: { jobs: AddJobOptions<TData>[] }): Promise<AddJobResult[]>` — bulk enqueue, one round-trip where the engine allows.

`AddJobOptions<TData>` = `{ data: TData }` **plus** the per-job `JobOptions` (05.6). No positional data argument — `data` is a named key. For a workflow queue it may also carry `startStep?: StepKey` (optional; defaults to the definition's entry step — see 05.3). It may also carry:
- `schedule?: ScheduleSpec` — **when present, `addJob` creates/updates a recurring schedule** rather than inserting one concrete job; `data` + the job options become the **template** for every produced run (05.6). `ScheduleSpec`:
  - `key: string` — stable id; re-adding with the same `(queue, key)` **updates** the schedule (idempotent), never duplicates.
  - exactly one of `cron: string` **or** `every: Duration` (`ck` enforced — never both, never neither).
  - `timezone?: string` — IANA tz for cron (file 06).
  - `startAt?: Date` / `endAt?: Date` — optional active bounds.

`AddJobResult` (one shape for both modes; fields populated per mode):
- `jobId?: string` — the inserted job (present for a **one-off** add; absent when only a schedule was created — a schedule produces jobs later, on scheduler ticks).
- `scheduleId?: string` — the schedule's correlation id: present when `schedule` was passed (created/updated), and on any job later **produced** by a schedule. Stamped on every produced job (the "repeat/cron id").
- `nextRunAt?: Date | null` — present for a scheduled add: when the first/next run materializes.
- `queue: string`.
- `status?: JobStatus` — the created job's status (one-off; usually `PENDING`, or the existing job's status on an idempotent hit).
- `deduplicated: boolean` — true if an `idempotencyKey` matched an existing job (then `jobId` is the existing one, nothing was inserted).
- `deduplicationReason?: DeduplicationReason` — enum (`IDEMPOTENCY | SINGLETON`) present only when `deduplicated` is true.
- `startAfter?: Date` — when a one-off job becomes due (now, or the delay target).
- `workflowId?: string` — present only when this queue is a **workflow queue**; the id minted for the run this job starts.

### Starting a workflow *is* adding a job — file 06

There is **no separate producer call for workflows.** The only difference between a simple queue and a workflow queue is the consumer: a simple queue's worker has one `handler`, a workflow queue's worker has many `steps`. Producing is `addJob({ data })` in both cases.

- When the queue was obtained from a `WorkflowDefinition` (`pq.createQueue(orderWorkflow)`, 05.2), `addJob({ data })` **starts a run**: the engine mints a `workflowId`, stamps `workflow_step_key` with the definition's **entry step** (`steps[0].key`), and stores `data` as that step's input. `AddJobResult.workflowId` is populated. The caller passes **exactly what it passes for a simple job** — just `{ data }` (plus any `JobOptions`).
- `addJobs` works the same — each entry starts its own run.
- `startStep?: StepKey` is an **optional** field on `AddJobOptions` for the rare case of beginning at a non-entry step; omit it and runs start at `steps[0]`. (This is why `workflow_step_key` is always set on a workflow job even though you never *have* to pass it — see file 04.2.)
- `getWorkflow(options: { workflowId: string }): Promise<WorkflowSnapshot | null>` — the whole run: its steps as an **ordered list of `JobSnapshot`s** (by `created_at`), each with its `workflowStepKey`, status, timings, `data` (input), `return_value` (output), and `failure_message` — the typed replacement for the old `steps_history` log (also on `pq`, 05.2).

**Defining a workflow once, sharing it across tiers.** `defineWorkflow<TData, TQueue extends string = string>({ queue, steps }): WorkflowDefinition<TData, TQueue>` (05.7) is a **pure** factory (no I/O): it validates unique keys, records the ordered `steps` and the `entryStep` (`steps[0].key`), and is imported by **both** the producer tier (`pq.createQueue(definition).addJob(...)`) and the worker tier (`pq.createWorker(definition)`), so step keys and their order are a single source of truth across the produce/consume split. Its `queue` is captured as a literal type, so a `PortQueue<QueueName>` accepts the definition only when its `queue` is one of `QueueName`.

### Recurring / scheduled production
Scheduling is **not a separate method** — it is `addJob({ data, schedule })` (above). Likewise, unscheduling is `removeSchedule({ scheduleId })` (Job control, below). What remains here is read-only:
- `getSchedules(): Promise<ScheduleInfo[]>` — list this queue's recurring definitions (`ScheduleInfo`: `scheduleId`, `key`, `cron`/`every`, `timezone`, `nextRunAt`, `lastRunAt`, `enabled`, active bounds).

`scheduleId` (returned in `AddJobResult` from a scheduled add) is the correlation id stamped on every produced job (the "repeat_id/cron_id").

### Inspection (scoped to this queue)
- `getJob(options: { jobId }): Promise<JobSnapshot<TData> | null>`.
- `getJobs(options: GetJobsQuery): Promise<Page<JobSnapshot<TData>>>`.
- `getQueueStats(): Promise<QueueStats>`.

### Job control
- `retryJob(options: { jobId; from?: RetryMode }): Promise<AddJobResult>` — requeue a failed/completed job. `RetryMode` (enum): `FROM_FAILED_STEP` (default — re-arm the failed step's own job with its persisted `data`) or `FROM_START` (begin a **fresh workflow run** from the entry step under a new `workflowId`, seeded from the original run's entry-step data). For single-function jobs the two are equivalent. There is intentionally **no arbitrary-step option** — see file 06.8.1 for why (skipping steps would feed a step the wrong carried-over input and skip prior side effects).
- `cancelJob(options: { jobId }): Promise<boolean>` — cancel a not-yet-active job (`PENDING`/`RETRY` → `CANCELLED`).
- `cancelRunningJob(options: { jobId }): Promise<boolean>` — request cooperative cancellation of an **active** job by firing its `job.signal` (`AbortSignal`) on the owning instance; the handler must observe the signal to actually stop. Returns whether a cancel was signaled. (An active job cannot be force-killed in v1 — no worker threads; document this clearly.)
- `removeJob(options: { jobId: string }): Promise<boolean>` — remove one job.
- `removeSchedule(options: { scheduleId: string }): Promise<boolean>` — remove a recurring definition ("unschedule"). Stops future production but does **not** delete jobs it already produced (remove those by id/status if wanted — documented). Split from `removeJob` per the entity-naming rule (README) — a method names the one entity it acts on.
- `removeJobs(options: { jobIds: string[] } | { statuses: JobStatus[] }): Promise<number>` — bulk job removal (dashboard bulk actions).
- `purgeJobs(options: { statuses: JobStatus[] }): Promise<number>`.

### Queue control — the single processing-control surface
Processing is controlled here, on the `Queue`, **not** on the `Worker` (which exposes nothing — 05.4). These flags are **persisted**, so flipping one on any instance (or via dashboard/CLI) is observed by **every** instance's workers — this is what "stop accepting new jobs / pause handling / resume" means cluster-wide.
- `pause(options?: { mode?: PauseMode }): Promise<void>` — `PauseMode` enum:
  - `PROCESSING` (default) — **pause handling**: workers stop claiming/running jobs, but the queue still **accepts** new `add`s (they pile up as `PENDING`).
  - `ALL` — also **stop accepting** new jobs (`add` is refused) in addition to pausing handling — the drain/incident control.
- `resume(): Promise<void>` — clear both pause flags; workers resume claiming and the queue accepts again.
- `get name(): string`.

> There is intentionally no per-worker start/stop. "Start/stop processing this queue" **is** `pause`/`resume` (persisted, cluster-wide); process-level lifecycle (drain on shutdown) is `pq.shutdown()` (file 07.6). This keeps one obvious control surface instead of two overlapping ones (queue pause vs worker stop).

### Transactional enqueue (file 09)
- Producing methods (`addJob`, `addJobs`, `removeJob`, `removeSchedule`, …) accept an optional **`tx?: TransactionHandle`** so the insert joins the developer's **own** transaction — the job exists iff their business write commits.
- **PortQueue never opens, commits, or rolls back a transaction.** There is **no `pq.transaction(fn)` and no `pq.adoptTransaction(...)`.** The developer starts a transaction with their own ORM/query-builder, wraps it with a small **adapter**, and passes the result as `tx`:

```ts
await knex.transaction(async (trx) => {
  await trx('orders').insert(order);
  await pq.createQueue('fulfillment').addJob({ data: { orderId }, tx: fromKnex(trx) });
}); // the developer's trx owns commit/rollback; our INSERT runs on it
```

- **Adapters** (exported from a subpath, one per ecosystem) turn a native transaction/connection into a `TransactionHandle`: `fromKnex`, `fromTypeorm` (an `EntityManager`/`QueryRunner`), `fromPrisma` (an interactive-tx client), `fromDrizzle`, `fromKysely`, `fromSequelize`, `fromMikroOrm`, and the raw clients `fromPg` (`pg` `PoolClient`/`Client`), `fromBetterSqlite3`, `fromNodeSqlite`, `fromOracle` (`oracledb` connection). See file 09 for the full list + how to write one. When no `tx` is passed, the method runs autonomously in its own short transaction.

## 05.4 `Worker<TData, TResult>` — the consumer (registration only)

Created via `pq.createWorker(options)`. A worker is a **registration, not a control surface**: it begins claiming automatically once `pq.init()` has run and its queue is not paused, and it stops when the client stops (graceful drain, file 07.6). **`Worker` exposes no public methods and no events** — all control lives on the `Queue` (05.3) and all observation on the `PortQueue` events (05.2 / file 08). `createWorker` returns an opaque handle you may keep a reference to, but there is nothing to call on it.

`WorkerOptions<TData, TResult, TQueues extends string = string>`:
- `queue: TQueues` — **required**; constrained to the client's queue-name enum (05.2). When you pass a `WorkflowDefinition`, its `queue` supplies this.
- Exactly one of:
  - `handler: JobHandler<TData, TResult>` — single-function processor, or
  - `steps: WorkflowStep<TData>[]` — an **ordered array** of steps for a **workflow** (multi-step job, file 06), each `{ key: StepKey; handler: StepHandler<TData> }` — a handler **for every step**. The **array order is the canonical sequence**: `steps[0]` is the **entry step** (where a run starts and where `FROM_START` resets to), and it defines "what comes next" (the next `workflow_step_key` is computed from this order unless a handler jumps). We require an **array with explicit `key`s** — not a map/object — so ordering is deterministic and never relies on object key order. Each `key` must be unique (validated when the definition is built). Prefer passing a `WorkflowDefinition` from `defineWorkflow(...)` (05.3) so the producer and worker tiers share one definition. `TResult` applies to the single-`handler` form; a workflow's result is whatever the terminal step passes to `step.done({ result })`.
- `concurrency?: number` — max in-flight handlers (default 1).
- `limiter?: RateLimiterOptions` — `{ max: number; duration: Duration }` token bucket (file 07). Worker-**local** rate limit (exact, in-process). Distinct in scope from `QueueOptions.rateLimit` (cluster-wide) — see 05.6/file 07.
- `batchSize?: number` — max jobs claimed per fetch (default derived from concurrency).
- `pollIntervalMs?: number` — poll cadence when LISTEN/NOTIFY is unavailable (file 03).
- `lockDurationMs?: number` — visibility timeout / heartbeat window (default e.g. 30s).
- `respectSystemPressure?: boolean` — default true; pause claiming under backpressure (file 07).
- `dontAutoretryFor?: Array<ErrorClass | string>` — **Celery-style non-retryable errors.** A list of error constructors (matched by `instanceof`) or error-name strings (matched by `error.name`). When a handler throws an error matching any entry, the job **skips its remaining attempts** and goes straight to `FAILED`, regardless of `retryMaxAttempts`. Because it matches on error *classes* — which only exist in the consumer's code — it lives here, not on the job row, and is evaluated in-process by the execution path (file 06.4). `ErrorClass` is `new (...args: any[]) => Error`.

> `WorkerOptions` contains **only consumer concerns**. The retry *schedule* (how many attempts, delay, backoff) is a producer/job concern and belongs on the job/queue. Which thrown error *types* are non-retryable (`dontAutoretryFor`) is a consumer concern — the error classes live in handler code — so it belongs here; the two never overlap.

**No worker lifecycle methods.** There is deliberately no `worker.start/stop/pause/resume`, no `worker.on/off/once`, and no `isRunning`/`activeCount`:
- **To control processing** — pause/resume handling, or stop accepting new jobs — use the **`Queue`** (`queue.pause({ mode })` / `queue.resume()`, 05.3). Those flags are persisted, so they take effect across the whole cluster, not just one process.
- **To observe** — handler outcomes, worker start/stop, loop errors — subscribe on the **client**: `pq.on(PortQueueEvent.JOB_COMPLETED | JOB_FAILED | WORKER_STARTED | WORKER_STOPPED | ERROR, cb, { queue })` (file 08). This is why there is no per-worker `onError` option — loop/handler errors surface as `PortQueueEvent.ERROR` and `JOB_FAILED`.
- **To shut down** — use client `pq.shutdown({ graceful, timeoutMs })` (file 07.6), which drains every worker on the instance. There is no per-worker autostart/stop; a worker starts with the client and stops with it, and is otherwise gated by the queue's pause state.

`JobHandler<TData, TResult>` = `(job: Job<TData>) => Promise<TResult> | TResult`. Returning resolves the job (`return_value` stored). Throwing triggers retry/fail per policy. **A throw never crashes the loop** (file 10).

For workflow (multi-step) workers, each step is a `WorkflowStep` `{ key: StepKey; handler: StepHandler<TData> }`, where `StepHandler` has the shape `(job: Job<TData>, step: StepController) => Promise<StepOutcome>` — see 05.5 and file 06. The `step` controller argument (not the `job`) owns step transitions; step keys are explicit and the ordered `steps` array fixes their sequence and thus the next `workflow_step_key`.

## 05.5 `Job<TData>` — the handler context

The object passed to a handler. Read-only fields + a few control methods.

**Fields:**
- `id: string`, `queue: string`, `data: TData`, `retryAttempt: number`, `retryMaxAttempts: number`.
- `priority: number`, `createdAt: Date`, `startAfter: Date`.
- `scheduleId?: string` — set if produced by a schedule.
- `idempotencyKey?: string`.
- `workflowId?: string`, `workflowStepKey?: StepKey` — for a workflow (multi-step) job (file 06): the run id shared by every step, and the step **this** job runs. The step's **input is `job.data`** (the value the previous step carried over, or the original payload for the entry step); its output is what the handler returns via the `step` controller. To read earlier steps' outputs or render a timeline, fetch the run with `getWorkflow({ workflowId })` — there is **no** `stepsHistory`/`lastStepReturnValue` field, because each step is its own queryable `job` row.
- `metadata: JobMetadata` — instance attribution etc.
- `signal: AbortSignal` — aborts on graceful shutdown timeout / stop, so long handlers can bail (file 07).

**Methods (all named-options where >1 arg):**
- `extendLock(options?: { byMs?: number }): Promise<void>` — manually extend the visibility timeout for a long unit of work (heartbeat is automatic; this is an override).
- **Multi-step (workflow) control is on the `step` controller argument, not on `Job`.** A step handler `(job, step) => ...` returns one of the controller's outcomes: `step.next({ to?, data? })` (advance — `to` optional, defaults to the next step in declared order, else jump; `data` becomes the next step's `data`/input and is stored as this step's `return_value`, defaulting to the current `data` carried unchanged), `step.repeat({ data?, delayMs? })` (spawn another job for the same step, optionally delayed), or `step.done({ result? })` (finish the whole run). This is the single, canonical model (file 06) — each outcome completes this step's job and, except for `done`, atomically spawns the next step's job. There is no `completeWith` and no step method on `Job`.

`Job` is **not** how you construct jobs — it's the runtime view. Producers use `AddJobOptions`.

## 05.6 Option types (the four disjoint bags)

### `JobOptions` (producer, per-job — highest precedence)
- `priority?: number`
- `delay?: Duration` **or** `startAfter?: Date | Duration` (mutually exclusive; both express "not before").
- `retryMaxAttempts?: number`
- `retryDelay?: Duration` — base delay between retries.
- `retryBackoff?: BackoffOptions` — an **object**: `{ strategy: BackoffStrategy; factor?: number; maxDelay?: Duration; jitter?: boolean }`, where `BackoffStrategy` is the enum (`FIXED | EXPONENTIAL`). (Canonical shape — file 06 and the examples in file 19 use this object form; `BackoffStrategy` is the enum used *inside* it, never the option's own type.)
- `expireIn?: Duration` — expire the job if not started by then.
- `retention?: RetentionOptions` — override how long to keep this job after finishing.
- `idempotencyKey?: string` — dedup guard.
- `singletonKey?: string` — at most one active job with this key.
- `metadata?: JobMetadata` — a small **opaque JSON** object for the developer's own correlation/tracing values (e.g. `traceId`, `tenantId`). Stored in one dedicated `metadata` JSON column (the *one* sanctioned bookkeeping-JSON exception beyond the payload — see file 04). Size-bounded; not indexed. Do not use it for anything the engine must query.
- `tx?: TransactionHandle` — transactional enqueue: your own transaction wrapped by an adapter (`fromKnex(trx)`, `fromPg(client)`, …). PortQueue runs its insert on it and never commits/rolls back (file 09).

### `QueueOptions` (queue definition — defaults for its jobs + queue-level policy)
- `defaultJobOptions?: JobOptions` — defaults every job on this queue inherits (job overrides). **In-memory only** — these are held on the `PortQueue` instance and merged at `add()` time; they are **not** persisted to the `queue` table (file 04.3). The resolved values are frozen onto each `job` row.
- `retention?: RetentionOptions` — the queue's default retention; resolved per-job and frozen onto each `job` row (not stored on the queue).
- `rateLimit?: RateLimiterOptions` — a queue-wide cap (distinct from a worker's local `limiter`; file 07). The `max`/`duration` are in-memory config; only the shared **usage counter** is DB-backed (file 07.4). Not persisted as config.
- `priorityEnabled?: boolean`.

> Only the pause flags reach the `queue` table (runtime control an operator flips live). Everything else on `QueueOptions` — defaults, rate limit, retention — stays on the instance (same code / shared config module across deployments) and is read from the live `PortQueue`, not the DB (file 04.3).

### `WorkerOptions` — consumer-only (05.4). Never contains job/priority/delay fields.

### `PortQueueOptions` — client-wide (05.2). `defaultJobOptions` here is the lowest-precedence default.

**Precedence (lowest → highest):** client `defaultJobOptions` → queue `defaultJobOptions` → per-`addJob` `JobOptions`. Resolved by `option-resolver` (file 02) at insert time; job wins ties (raw-plan rule).

## 05.7 Exported enums & types (the "no magic strings" surface)

From the barrel: `PortQueue`, `Queue`, `Worker`, `Job` (type), and:
- Enums: `JobStatus`, `PortQueueEvent`, `MigrationMode`, `PauseMode`, `BackoffStrategy`, `RetryMode`, `DeduplicationReason`, `DatabaseEngine`, `DriverCapability`, `InstanceType`, `LogLevel`, `HookPhase`, `PortQueueErrorCode`, plus each workflow's `StepKey` is user-defined (they pass their own enum). (There is **no** `WorkerEvent` — events are global on `PortQueue` only; file 08.)
- Types/interfaces: all option types (05.6), all result types (`AddJobResult` — carries `jobId?`/`scheduleId?`/`nextRunAt?`/`workflowId?`, …), `ScheduleSpec`, `ScheduleInfo`, `JobSnapshot`, `WorkflowStep`, `WorkflowDefinition`, `WorkflowSnapshot`, `StepController`, `StepOutcome`, `QueueStats`, `Page<T>`, `Duration`, `Driver`, `DriverCapabilitySet`, `TransactionHandle`, `Logger`, error classes.
- Helpers: `defineWorkflow()` (pure workflow definition factory, 05.3), the transaction **adapters** (`fromKnex`, `fromTypeorm`, `fromPrisma`, `fromDrizzle`, `fromKysely`, `fromSequelize`, `fromMikroOrm`, `fromPg`, `fromBetterSqlite3`, `fromNodeSqlite`, `fromOracle` — file 09, likely from an `@portqueue/core/tx` subpath), `duration()` for `"30s"` parsing if we expose the string form, and any small pure utilities.

## 05.8 Ergonomic decisions & rationale (put in docs)

- **Why a separate `Queue` and `Worker`** (vs pg-boss's single object): it makes "produce on API servers, consume on worker servers" a first-class, obvious deployment — you simply don't call `createWorker` on the API tier. Mirrors BullMQ's proven split.
- **Why `data` is a named key** and not the first positional arg (unlike pg-boss/BullMQ `add(name, data, opts)`): consistency. Every method is a single options object, so there are zero "which arg was which" mistakes and adding an option is never a breaking signature change.
- **Why jobs have no name** (unlike BullMQ's `add(name, data)`): from experience the per-job name **confuses developers, who conflate it with the queue name**, and it isn't needed. Routing is the **queue's** job (one worker per queue, so a job's *kind* is just which queue it's on), and multi-step routing is the workflow **`StepKey`** (file 06) — not a job name. `add({ data })` therefore takes no name; correlation/labels a developer genuinely wants live in `metadata` (opaque, for tracing) or `idempotencyKey` (dedup). This keeps the one-vs-many distinction crisp: a queue is a *simple* queue if its worker has one handler and a *workflow* queue if it has many steps — never a bag of differently-named jobs.
- **Why results are objects:** callers frequently need `deduplicated` and `scheduleId`; returning a bare id forces a second lookup and hides the idempotency outcome.
- **Why `steps` (workflows) instead of progress:** numeric progress can't resume mid-way. An ordered `steps` array where **each step is its own job row** (sharing a `workflowId`) resumes exactly where it stopped, survives crashes (the un-advanced step is just a claimable job), load-balances across instances, and is fully introspectable in the dashboard — no JSON log required.
- **Method existence over silent gaps:** a method unsupported for a given queue type (e.g. step control on a single-function worker) still exists and throws a typed error telling the developer the right path — so discoverability never suffers.

## 05.9 Local final-check checklist

- [ ] Every method with >1 input takes one named-options object; `data` is a named key, never positional.
- [ ] **Entity-naming rule** (README): every public method names the entity it acts on — job methods contain `Job`/`Jobs` (`addJob`, `retryJob`, `cancelJob`, `removeJob`, `purgeJobs`, `getJob`), queue methods contain `Queue` (`createQueue`, `pauseQueue`, `getQueueStats`), worker methods contain `Worker` (`createWorker`), schedule methods contain `Schedule` (`removeSchedule`, `getSchedules`). Only queue-self controls on the scoped `Queue` handle (`pause`/`resume`) may drop the word since the receiver *is* the queue.
- [ ] `Queue` (produce), `Worker` (consume), and client are cleanly separated; option bags are disjoint.
- [ ] All producing methods return a result object including `deduplicated`; a scheduled `addJob` returns `scheduleId`/`nextRunAt`.
- [ ] Scheduling is a `schedule` option on `addJob` (no separate `schedule()`); unscheduling is `removeSchedule({ scheduleId })`.
- [ ] All state/event/step/capability/error/engine/instance values are exported enums.
- [ ] Generics carry payload type through `Queue`, `Worker`, `Job`; no `any` in signatures.
- [ ] `PortQueue<TQueues>` threads the queue-name enum through `createQueue`, `createWorker`, `pauseQueue`/`resumeQueue`, `getQueueStats`/`getJobs`, and the event `{ queue }` filter; defaults to `string` when omitted.
- [ ] Precedence client < queue < job is implemented and documented.
- [ ] Unsupported-for-this-type methods still exist and throw a typed, explanatory error.
- [ ] `tx?` (a user transaction wrapped by an adapter) is accepted by every producing method; PortQueue never opens/commits/rolls back a transaction — no `pq.transaction`/`adoptTransaction`.
