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

```
const pq = new PortQueue({ driver: new PostgresDriver({ ... }) });
await pq.start();

const emails = pq.queue('emails');                 // producer handle
await emails.add({ data: { to: 'a@b.com' } });

const worker = pq.createWorker({                    // consumer
  queue: 'emails',
  concurrency: 10,
  handler: async (job) => { await send(job.data); },
});
await worker.start();
```

## 05.2 `PortQueue`

### Construction — `new PortQueue(options: PortQueueOptions)`

`PortQueueOptions`:
- `driver: Driver` — a driver instance (from a subpath import or a custom one). **Required.**
- `logger?: Logger | LoggerOptions` — inject a logger or configure the built-in (file 10).
- `schema?: string` — DB schema/namespace.
- `tablePrefix?: string` — default `'pq_'`.
- `migration?: MigrationMode` — enum `AUTO | MANUAL | VALIDATE_ONLY`, default `AUTO`.
- `defaultJobOptions?: JobOptions` — client-wide job defaults (lowest precedence; queue and job override).
- `monitor?: SystemMonitorOptions | false` — system-pressure backpressure (file 07); `false` disables.
- `retention?: RetentionOptions` — client-wide default retention (file 06).
- `maxPayloadBytes?: number` — reject `add` when the serialized `data` exceeds this, with a clear error (file 18); default e.g. 1 MiB. Overridable per queue.
- `instance?: InstanceIdentityOptions` — override auto-detected instance id/type (file 07).
- `namespace?: string` — logical prefix for pub/sub channels when multiple PortQueues share one DB.

Construction wires DI only — **no connection, no I/O**.

### Lifecycle
- `start(): Promise<void>` — connect, migrate, start services (file 02.4). Idempotent; safe to await once.
- `stop(options?: StopOptions): Promise<void>` — `StopOptions { graceful?: boolean (default true); timeoutMs?: number; drain?: boolean }`. Graceful shutdown (file 07).
- `get isRunning(): boolean`.

### Handles
- `queue<TData = unknown>(name: string, options?: QueueOptions): Queue<TData>` — get/define a producer. Registers the queue definition lazily (`ensureQueue`). Passing `options` on first use sets its defaults.
- `createWorker<TData = unknown, TResult = unknown>(options: WorkerOptions<TData, TResult>): Worker<TData, TResult>`.

### Cross-cutting reads (used by dashboard/CLI and available to devs)
- `getQueues(): Promise<QueueInfo[]>`.
- `getStats(options?: { queue?: string }): Promise<QueueStats>` — counts by state, throughput, failure rate.
- `getJob<TData>(options: { jobId: string }): Promise<JobSnapshot<TData> | null>`.
- `getJobs<TData>(options: GetJobsQuery): Promise<Page<JobSnapshot<TData>>>` — `GetJobsQuery { queue?; states?: JobState[]; scheduleId?; limit?; cursor?; order? }` (cursor-based paging for the dashboard).

### Global events & hooks (file 08)
- `on(event: PortQueueEvent, listener): Unsubscribe` / `off(...)` / `once(...)`.
- `useHook(hook: HookRegistration): Unsubscribe` — register participation hooks (before/after add, before/after process).

### Direct control (convenience; also on `Queue`)
- `pauseQueue(options: { queue: string }): Promise<void>` / `resumeQueue(options: { queue: string })`.

## 05.3 `Queue<TData>` — the producer

Bound to one queue name.

### Adding jobs
- `add(options: AddJobOptions<TData>): Promise<AddJobResult>` — enqueue one job.
- `addBulk(options: { jobs: AddJobOptions<TData>[] }): Promise<AddJobResult[]>` — one round-trip where the engine allows.

`AddJobOptions<TData>` = `{ data: TData }` **plus** the per-job `JobOptions` (05.6). No positional data argument — `data` is a named key.

`AddJobResult`:
- `jobId: string`
- `queue: string`
- `state: JobState` — usually `CREATED` (or the existing job's state on idempotent hit).
- `deduplicated: boolean` — true if an `idempotencyKey` matched an existing job (then `jobId` is the existing one, nothing was inserted).
- `deduplicationReason?: DeduplicationReason` — enum (`IDEMPOTENCY | SINGLETON`) present only when `deduplicated` is true, so the caller can tell an idempotent replay from a singleton-in-flight collision.
- `availableAt: Date` — when it becomes due (now, or the delay target).
- `scheduleId?: string` — present only if produced via a schedule (not for plain `add`).

### Recurring / scheduled production
- `schedule(options: ScheduleOptions<TData>): Promise<ScheduleResult>` — create/replace a recurring producer.
- `unschedule(options: { key: string }): Promise<boolean>`.
- `getSchedules(): Promise<ScheduleInfo[]>`.

`ScheduleOptions<TData>`:
- `key: string` — stable id; re-calling with the same key **updates** (idempotent), never duplicates.
- exactly one of `cron: string` or `every: Duration` (ms number or a `"30s"`/`"5m"` string).
- `timezone?: string` — IANA tz for cron (file 06).
- `data?: TData` — payload template.
- `jobOptions?: JobOptions` — options applied to each produced job.
- `startAt?: Date` / `endAt?: Date` — optional bounds.

`ScheduleResult`: `{ scheduleId: string; key: string; queue: string; nextRunAt: Date | null }`. `scheduleId` is the correlation id stamped on every produced job (the "repeat_id/cron_id").

### Inspection (scoped to this queue)
- `getJob(options: { jobId }): Promise<JobSnapshot<TData> | null>`.
- `getJobs(options: GetJobsQuery): Promise<Page<JobSnapshot<TData>>>`.
- `getStats(): Promise<QueueStats>`.

### Job control
- `retry(options: { jobId }): Promise<AddJobResult>` — requeue a failed/completed job.
- `cancel(options: { jobId }): Promise<boolean>` — cancel a not-yet-active job (`CREATED`/`RETRY` → `CANCELLED`).
- `cancelRunning(options: { jobId }): Promise<boolean>` — request cooperative cancellation of an **active** job by firing its `job.signal` (`AbortSignal`) on the owning instance; the handler must observe the signal to actually stop. Returns whether a cancel was signaled. (An active job cannot be force-killed in v1 — no worker threads; document this clearly.)
- `remove(options: { jobId }): Promise<boolean>`.
- `removeMany(options: { jobIds: string[] } | { states: JobState[] }): Promise<number>` — bulk (dashboard bulk actions).
- `purge(options: { states: JobState[] }): Promise<number>`.

### Queue control (the dashboard "stop accepting/handling" requirement)
- `pause(options?: { mode?: PauseMode }): Promise<void>` — `PauseMode` enum `PROCESSING` (default — still store new jobs, don't handle) or `ALL` (also refuse new jobs). Persisted; every instance's workers observe it.
- `resume(): Promise<void>`.
- `get name(): string`.

### Transactional enqueue (file 09)
- Every producing method accepts an optional `tx?: TransactionHandle` in its options object, so the insert joins the developer's transaction. Also `pq.transaction(fn)` helper — see file 09.

## 05.4 `Worker<TData, TResult>` — the consumer

Created via `pq.createWorker(options)`.

`WorkerOptions<TData, TResult>`:
- `queue: string` — **required**.
- Exactly one of:
  - `handler: JobHandler<TData, TResult>` — single-function processor, or
  - `steps: StepHandlerMap<TData>` — a map of step id → step handler for multi-step jobs (file 06). `TResult` applies to the single-`handler` form; a multi-step job's result is whatever the terminal step passes to `step.done(result)`.
- `concurrency?: number` — max in-flight handlers (default 1).
- `limiter?: RateLimiterOptions` — `{ max: number; duration: Duration }` token bucket (file 07). Worker-**local** rate limit (exact, in-process). Distinct in scope from `QueueOptions.rateLimit` (cluster-wide) — see 05.6/file 07.
- `batchSize?: number` — max jobs claimed per fetch (default derived from concurrency).
- `pollIntervalMs?: number` — poll cadence when LISTEN/NOTIFY is unavailable (file 03).
- `lockDurationMs?: number` — visibility timeout / heartbeat window (default e.g. 30s).
- `autostart?: boolean` — default false; if true, starts claiming as soon as the client is running.
- `onError?: (error, context) => void` — observe handler/loop errors (never throws out).
- `respectSystemPressure?: boolean` — default true; pause claiming under backpressure (file 07).
- `captureLogs?: { maxLines?: number } | false` — persist the last N `job.log()` lines to the job row for the dashboard (file 04); default off (logs go to the injected `Logger` only).

> `WorkerOptions` contains **only consumer concerns**. Producer/job concerns (priority, delay, retry policy) belong on the job/queue, not here — enforced by keeping the types disjoint.

`Worker` methods:
- `start(): Promise<void>` — begin claiming.
- `stop(options?: StopOptions): Promise<void>` — stop claiming; drain in-flight per graceful/timeout.
- `pause(): Promise<void>` / `resume(): Promise<void>` — local, in-process pause (distinct from the persisted queue pause on `Queue`).
- `on(event, listener)` / `off` / `once` — worker-scoped events (file 08).
- `get isRunning(): boolean`, `get activeCount(): number`.

`JobHandler<TData, TResult>` = `(job: Job<TData>) => Promise<TResult> | TResult`. Returning resolves the job (`result` stored). Throwing triggers retry/fail per policy. **A throw never crashes the loop** (file 10).

For multi-step workers, a `StepHandler` has the shape `(job: Job<TData>, step: StepController) => Promise<StepOutcome>` — see 05.5 and file 06. The `step` controller argument (not the `job`) owns step transitions.

## 05.5 `Job<TData>` — the handler context

The object passed to a handler. Read-only fields + a few control methods.

**Fields:**
- `id: string`, `queue: string`, `data: TData`, `attempt: number`, `maxAttempts: number`.
- `priority: number`, `createdAt: Date`, `availableAt: Date`.
- `scheduleId?: string` — set if produced by a schedule.
- `idempotencyKey?: string`.
- `step?: StepId`, `stepData?: unknown` — for multi-step (file 06).
- `metadata: JobMetadata` — instance attribution etc.
- `signal: AbortSignal` — aborts on graceful shutdown timeout / stop, so long handlers can bail (file 07).

**Methods (all named-options where >1 arg):**
- `log(message: string, options?: { level?: LogLevel }): void` — emit a handler log line. **By default it routes through the injected `Logger`** with the job's context (`jobId`, `queue`, `attempt`) — always available, zero storage. **Optionally persisted** for the dashboard: when `captureLogs` is enabled (a `WorkerOptions.captureLogs?: { maxLines?: number }` / client default), the most recent N lines are appended to a bounded `log` column on the job row (file 04) so the job-detail page can show them. Capture is off by default to respect the minimal-storage rule; the dashboard shows "log capture disabled" when off.
- `extendLock(options?: { byMs?: number }): Promise<void>` — manually extend the visibility timeout for a long unit of work (heartbeat is automatic; this is an override).
- **Multi-step control is on the `step` controller argument, not on `Job`.** A step handler `(job, step) => ...` returns one of the controller's outcomes: `step.next(stepId, { data })` (advance, persisting `data` as the new `stepData`), `step.repeat({ data?, delayMs? })` (re-run the same step), or `step.done(result)` (finish the whole job). This is the single, canonical step model (file 06) — designed so a step resumes from `stepData` (our resumable alternative to numeric progress). There is no `completeWith` and no step method on `Job`.

`Job` is **not** how you construct jobs — it's the runtime view. Producers use `AddJobOptions`.

## 05.6 Option types (the four disjoint bags)

### `JobOptions` (producer, per-job — highest precedence)
- `priority?: number`
- `delay?: Duration` **or** `startAfter?: Date | Duration` (mutually exclusive; both express "not before").
- `maxAttempts?: number`
- `retryDelay?: Duration` — base delay between retries.
- `retryBackoff?: BackoffOptions` — an **object**: `{ strategy: BackoffStrategy; factor?: number; maxDelay?: Duration; jitter?: boolean }`, where `BackoffStrategy` is the enum (`FIXED | EXPONENTIAL`). (Canonical shape — file 06 and the examples in file 19 use this object form; `BackoffStrategy` is the enum used *inside* it, never the option's own type.)
- `expireIn?: Duration` — expire the job if not started by then.
- `retention?: RetentionOptions` — override how long to keep this job after finishing.
- `idempotencyKey?: string` — dedup guard.
- `singletonKey?: string` — at most one active job with this key.
- `metadata?: JobMetadata` — a small **opaque JSON** object for the developer's own correlation/tracing values (e.g. `traceId`, `tenantId`). Stored in one dedicated `metadata` JSON column (the *one* sanctioned bookkeeping-JSON exception beyond the payload — see file 04). Size-bounded; not indexed. Do not use it for anything the engine must query.
- `tx?: TransactionHandle` — transactional enqueue.

### `QueueOptions` (queue definition — defaults for its jobs + queue-level policy)
- `defaultJobOptions?: JobOptions` — defaults every job on this queue inherits (job overrides).
- `deadLetterQueue?: string` — where terminally failed jobs go.
- `retention?: RetentionOptions`.
- `rateLimit?: RateLimiterOptions` — a queue-wide rate cap (distinct from a single worker's `limiter`; file 07).
- `priorityEnabled?: boolean`.

### `WorkerOptions` — consumer-only (05.4). Never contains job/priority/delay fields.

### `PortQueueOptions` — client-wide (05.2). `defaultJobOptions` here is the lowest-precedence default.

**Precedence (lowest → highest):** client `defaultJobOptions` → queue `defaultJobOptions` → per-`add` `JobOptions`. Resolved by `option-resolver` (file 02) at insert time; job wins ties (raw-plan rule).

## 05.7 Exported enums & types (the "no magic strings" surface)

From the barrel: `PortQueue`, `Queue`, `Worker`, `Job` (type), and:
- Enums: `JobState`, `PortQueueEvent`, `WorkerEvent`, `MigrationMode`, `PauseMode`, `BackoffStrategy`, `DeduplicationReason`, `DatabaseEngine`, `DriverCapability`, `InstanceType`, `LogLevel`, `HookPhase`, `PortQueueErrorCode`, plus each multi-step queue's `StepId` is user-defined (they pass their own enum).
- Types/interfaces: all option types (05.6), all result types (`AddJobResult`, `ScheduleResult`, …), `JobSnapshot`, `QueueStats`, `Page<T>`, `Duration`, `Driver`, `DriverCapabilitySet`, `Logger`, error classes.
- Helpers: `duration()` for `"30s"` parsing if we expose the string form, and any small pure utilities.

## 05.8 Ergonomic decisions & rationale (put in docs)

- **Why a separate `Queue` and `Worker`** (vs pg-boss's single object): it makes "produce on API servers, consume on worker servers" a first-class, obvious deployment — you simply don't call `createWorker` on the API tier. Mirrors BullMQ's proven split.
- **Why `data` is a named key** and not the first positional arg (unlike pg-boss/BullMQ `add(name, data, opts)`): consistency. Every method is a single options object, so there are zero "which arg was which" mistakes and adding an option is never a breaking signature change.
- **Why results are objects:** callers frequently need `deduplicated` and `scheduleId`; returning a bare id forces a second lookup and hides the idempotency outcome.
- **Why `steps` instead of progress:** numeric progress can't resume mid-way. A step map + `stepData` resumes exactly where it stopped, survives crashes, and is introspectable in the dashboard.
- **Method existence over silent gaps:** a method unsupported for a given queue type (e.g. step control on a single-function worker) still exists and throws a typed error telling the developer the right path — so discoverability never suffers.

## 05.9 Local final-check checklist

- [ ] Every method with >1 input takes one named-options object; `data` is a named key, never positional.
- [ ] `Queue` (produce), `Worker` (consume), and client are cleanly separated; option bags are disjoint.
- [ ] All producing methods return a result object including `deduplicated`; schedules return `scheduleId`.
- [ ] All state/event/step/capability/error/engine/instance values are exported enums.
- [ ] Generics carry payload type through `Queue`, `Worker`, `Job`; no `any` in signatures.
- [ ] Precedence client < queue < job is implemented and documented.
- [ ] Unsupported-for-this-type methods still exist and throw a typed, explanatory error.
- [ ] `tx?` is accepted by every producing method for transactional enqueue.
