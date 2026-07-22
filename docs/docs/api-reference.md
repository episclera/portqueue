---
id: api-reference
title: API Reference
sidebar_label: API Reference
---

# API Reference

Everything below is exported from `@portqueue/core`'s barrel. Drivers and transaction
adapters come from subpaths. Kept in sync with the public API (build_plan/05).

## Classes & factory

| Export | Purpose |
|---|---|
| `PortQueue<TQueues>` | The client. One per database. Owns connection, migration, services; produces handles. |
| `Queue<TData>` | Producer handle for one queue. |
| `Worker<TData, TResult>` | Consumer registration for one queue. |
| `defineWorkflow({ queue, steps })` | Pure factory for a `WorkflowDefinition`, shared by both tiers. |
| `duration()` | Parse a `Duration` string like `"30s"`. |
| `ConsoleLogger`, `NoopLogger` | Built-in loggers. |

## `PortQueue`

- `new PortQueue<TQueues>(options: PortQueueOptions)` — DI only, no I/O.
- `init(): Promise<void>` — connect, migrate, start services (idempotent).
- `shutdown(options?: ShutdownOptions): Promise<void>` — `{ graceful?, timeoutMs?, drain? }`.
- `get isRunning(): boolean`.
- `createQueue<TData>(nameOrWorkflow, options?): Queue<TData>`.
- `createWorker<TData, TResult>(options: WorkerOptions): Worker`.
- `getQueues()`, `getQueueStats({ queue? })`, `getJob({ jobId })`, `getJobs(query)`, `getWorkflow({ workflowId })`.
- `on(event, listener, filter?)` / `off(...)` / `once(...)`; `useHook(hook)`.
- `pauseQueue({ queue, mode? })` / `resumeQueue({ queue })`.

## `Queue<TData>`

- `addJob(options: AddJobOptions<TData>): Promise<AddJobResult>` — pass `schedule` to make it recurring.
- `addJobs({ jobs })`.
- `getSchedules()`, `getJob`, `getJobs`, `getQueueStats`.
- `retryJob({ jobId, from? })`, `cancelJob({ jobId })`, `cancelRunningJob({ jobId })`.
- `removeJob({ jobId })`, `removeSchedule({ scheduleId })`, `removeJobs(...)`, `purgeJobs({ statuses })`.
- `pause({ mode? })`, `resume()`, `get name()`.
- All producing methods accept an optional `tx?: TransactionHandle`.

## `Worker` — `WorkerOptions`

`queue` (required); exactly one of `handler` or `steps`; `concurrency?`, `limiter?`,
`batchSize?`, `pollIntervalMs?`, `lockDurationMs?`, `respectSystemPressure?`,
`dontAutoretryFor?`. **No lifecycle methods** — control via `Queue`, observe via `pq.on`.

## `Job<TData>` (handler context)

Fields: `id`, `queue`, `data`, `retryAttempt`, `retryMaxAttempts`, `priority`,
`createdAt`, `startAfter`, `scheduleId?`, `idempotencyKey?`, `workflowId?`,
`workflowStepKey?`, `metadata`, `signal`. Method: `extendLock({ byMs? })`. Workflow
transitions are on the `step` controller (`next` / `repeat` / `done`), not on `Job`.

## Option types (four disjoint bags)

- `JobOptions` — per-job (highest precedence): `priority`, `delay`/`startAfter`,
  `retryMaxAttempts`, `retryDelay`, `retryBackoff`, `expireIn`, `retention`,
  `idempotencyKey`, `singletonKey`, `metadata`, `tx`.
- `QueueOptions` — `defaultJobOptions`, `retention`, `rateLimit`, `priorityEnabled`.
- `WorkerOptions` — consumer-only (above).
- `PortQueueOptions` — `driver` (required), `logger`, `schema`, `tablePrefix`,
  `migration`, `defaultJobOptions`, `monitor`, `retention`, `maxPayloadBytes`,
  `instance`, `namespace`.

**Precedence (low → high):** client `defaultJobOptions` → queue `defaultJobOptions` → job.

## Result & snapshot types

`AddJobResult` (`jobId?`, `scheduleId?`, `nextRunAt?`, `queue`, `status?`, `deduplicated`,
`deduplicationReason?`, `startAfter?`, `workflowId?`), `JobSnapshot`, `WorkflowSnapshot`,
`ScheduleInfo`, `QueueInfo`, `QueueStats`, `GetJobsQuery`, `Page<T>`.

## Enums

`JobStatus`, `BackoffStrategy`, `RetryMode`, `PauseMode`, `DeduplicationReason`,
`RetentionMode`, `MigrationMode`, `DatabaseEngine`, `InstanceType`, `PortQueueEvent`,
`HookPhase`, `LogLevel`, [`PortQueueErrorCode`](./troubleshooting.md), `DriverCapability`.

## Drivers & transactions

- Drivers: `@portqueue/core/drivers/{postgres,pglite,sqlite,oracle}` — see [Drivers](./drivers/overview.md).
- Driver contract: `Driver`, `DriverProbe`, `Subscription`, `MigrationStep`,
  `DriverCapabilitySet`, `capabilities`, `DriverContext`; conformance kit at
  `@portqueue/core/conformance`.
- Transaction adapters (`@portqueue/core/tx`): `fromKnex`, `fromTypeorm`, `fromPrisma`,
  `fromDrizzle`, `fromKysely`, `fromSequelize`, `fromMikroOrm`, `fromPg`,
  `fromBetterSqlite3`, `fromNodeSqlite`, `fromOracle`.

## Errors

`PortQueueError` (base) plus `NotStartedError`, `InvalidOptionsError`,
`UnsupportedCapabilityError`, `UnsupportedForWorkerTypeError`,
`SchemaVersionMismatchError`, `MigrationFailedError`, `DriverConnectionError`,
`DriverQueryError`, `JobNotFoundError`, `QueuePausedError`, `PayloadTooLargeError`,
`ShutdownTimeoutError`, `MissingPeerDependencyError`. See [Troubleshooting](./troubleshooting.md).
