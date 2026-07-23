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
| `Worker<TData, TResult>` | Consumer registration for one queue (simple handler or workflow steps). |
| `duration()` | Parse a `Duration` string like `"30s"`. |
| `ConsoleLogger`, `NoopLogger` | Built-in loggers. |

## `PortQueue`

- `new PortQueue<TQueues>(options: PortQueueOptions)` — DI only, no I/O.
- `init(): Promise<void>` — connect, migrate, start services (idempotent).
- `shutdown(options?: ShutdownOptions): Promise<void>` — `{ graceful?, timeoutMs?, drain? }`.
- `get isRunning(): boolean`.
- `createQueue<TData>(name, options?): Queue<TData>`.
- `createWorker<TData, TResult>(options: WorkerOptions): Worker`.
- `getQueues()`, `getQueueStats({ queue? })`, `getJob({ jobId })`, `getJobs(query)`, `getWorkflow({ workflowId })`.
- `on(event, listener, filter?)` / `off(...)` / `once(...)`; `useHook(hook)`.
- `pauseQueue({ queue, mode? })` / `resumeQueue({ queue })`; `removeQueue({ name })` — manual, refused while the queue is still declared in this process.
- **Multi-instance:** `getInstances()` → `InstanceInfo[]`; `pauseInstance({ instanceKey })` / `resumeInstance({ instanceKey })`; `removeInstance({ instanceKey })` — refused until the instance has been unseen 30 min. See [Multi-server / instance](./scale-horizontally.md#choosing-a-preferred-server-with-regex-patterns).

## `Queue<TData>`

- `addJob(options: AddJobOptions<TData>): Promise<AddJobResult>` — pass `schedule: { startEvery }`/`schedule: { cron }` to make it recurring; pass `preferredInstanceKeyPattern` for [instance affinity](./scale-horizontally.md#attach-a-regex-pattern-to-the-job).
- `addJobs({ jobs })`.
- `getSchedules()`, `getJob`, `getJobs`, `getQueueStats`.
- `retryJob({ jobId, from? })`, `cancelJob({ jobId })`, `cancelRunningJob({ jobId })`.
- `removeJob({ jobId })`, `removeSchedule({ scheduleId })`, `removeJobs({ jobIds } | { statuses })`.
- `pause({ mode? })`, `resume()`, `get name()`.
- All producing methods accept an optional `tx?: TransactionHandle`.

## `Worker` — `WorkerOptions`

`queue` (required); `handler` (required) — either a single function (simple job) or an
ordered array of `{ key, handler }` steps (workflow); `limiter?: LimiterOptions` — one group
holding all throughput/claim throttles: `concurrency?` (default 1), `rateMax?` + `rateDuration?`
(token bucket, both required together), `respectSystemPressure?` (defaults to `false`),
`batchSize?`, `pollIntervalMs?`, `lockDurationMs?`; and `dontAutoretryFor?`. **No lifecycle
methods** — control via `Queue`, observe via `pq.on`.

## `Job<TData>` (handler context)

Fields: `id`, `queue`, `data`, `retryAttempt`, `retryMaxAttempts`, `priority`,
`createdAt`, `startAfter`, `scheduleId?`, `idempotencyKey?`, `workflowId?`,
`workflowStepKey?`, `metadata`, `signal`. Method: `extendLock({ byMs? })`. Workflow
transitions are on the `step` controller (`next` / `repeat` / `done`), not on `Job`.

## Option types (four disjoint bags)

- `JobOptions` — per-job (highest precedence): `priority`, `retry` (a `RetryOptions`:
  `{ maxAttempts?, delay?, backoff? }`), `expireIn`, `retention`, `idempotencyKey`,
  `singletonKey`, `metadata`, `tx`. On `AddJobOptions` also: `data`, `schedule` (a
  `ScheduleOptions`: `{ startAfter?, startEvery?, cron? }`, where `cron` is a `CronSpec` — a string
  or `{ pattern, tz }`), `startStep`, `preferredInstanceKeyPattern`.
- `QueueOptions` — `defaultJobOptions`, `retention`, `hooks`.
- `WorkerOptions` — consumer-only (above): `queue`, `handler`, `limiter` (a `LimiterOptions`),
  `dontAutoretryFor`.
- `PortQueueOptions` — `driver` (required), `logger`, `migration`, `storage` (a `StorageOptions`:
  `{ schema?, tablePrefix?, namespace? }`), `instance` (an `InstanceOptions`:
  `{ key?, id?, heartbeatIntervalMs? }`), `monitor`, `tickIntervalMs`. Job defaults and retention
  are **not** set here — they live on the queue so nothing is silently inherited client-wide.

Grouped option types: `RetryOptions`, `ScheduleOptions`, `LimiterOptions`, `RetentionOptions`,
`BackoffOptions`, `StorageOptions`, `InstanceOptions`.

**Precedence (low → high):** queue `defaultJobOptions` → job.

## Result & snapshot types

`AddJobResult` (`jobId?`, `scheduleId?`, `nextRunAt?`, `queue`, `status?`, `deduplicated`,
`deduplicationReason?`, `startAfter?`, `workflowId?`), `JobSnapshot`, `WorkflowSnapshot`,
`ScheduleInfo`, `QueueInfo`, `InstanceInfo`, `QueueStats`, `GetJobsQuery`, `Page<T>`.

## Enums

`JobStatus`, `BackoffStrategy`, `RetryMode`, `PauseMode`, `DeduplicationReason`,
`RetentionMode`, `MigrationMode`, `DatabaseEngine`, `PortQueueEvent`,
`HookPhase`, `LogLevel`, [`PortQueueErrorCode`](./troubleshooting.md), `DriverCapability`.

Schema identifiers (for driver authors / reporting): `TableName`, and the per-table column enums
`QueueColumn`, `JobColumn`, `ScheduleColumn`, `InstanceColumn`, `MigrationColumn`.

## Drivers & transactions

- Drivers: `@portqueue/core/drivers/{postgres,oracle,pglite,sqlite,mysql}` — one self-contained subpath export per engine.
- Driver contract: `Driver`, `DriverProbe`, `Subscription`, `MigrationStep`,
  `DriverCapabilitySet`, `capabilities`, `DriverContext`; conformance kit at
  `@portqueue/core/conformance`.
- Transaction adapters (`@portqueue/core/tx`): `fromKnex`, `fromTypeorm`, `fromPrisma`,
  `fromDrizzle`, `fromKysely`, `fromSequelize`, `fromMikroOrm`, `fromPg`,
  `fromOracle`, `fromBetterSqlite3`, `fromNodeSqlite`.

## Errors

`PortQueueError` (base) plus `NotStartedError`, `InvalidOptionsError`,
`UnsupportedCapabilityError`, `UnsupportedForWorkerTypeError`,
`SchemaVersionMismatchError`, `MigrationFailedError`, `DriverConnectionError`,
`DriverQueryError`, `JobNotFoundError`, `QueuePausedError`,
`ShutdownTimeoutError`, `MissingPeerDependencyError`. See [Troubleshooting](./troubleshooting.md).
