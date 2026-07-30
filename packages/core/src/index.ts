// @portqueue/core — the developer-facing barrel.

// Client, the queue registration, and the Job context type. There is no `Worker`: a queue declares
// its own handler, and the claim loop behind it is internal.
export { PortQueue } from './port-queue';
export { Queue } from './producer/queue';
export type { Job, JobHandler } from './jobs/job';

// Enums (no magic strings)
export { JobStatus } from './jobs/job-state.enum';
export {
  BackoffStrategy,
  PauseMode,
  DeduplicationReason,
  RetentionMode,
  MigrationMode,
  DatabaseEngine,
} from './options/enums';
export { PortQueueEvent } from './events/event-name.enum';
export { HookPhase } from './events/hooks';
export { LogLevel } from './logging/log-level.enum';
export { PortQueueErrorCode } from './errors/error-codes.enum';
export { DriverCapability } from './drivers/driver-capabilities';
// Schema identifiers — reusable by driver authors and dashboard/reporting code.
export {
  TableName,
  QueueColumn,
  JobColumn,
  ScheduleColumn,
  InstanceColumn,
  MigrationColumn,
} from './drivers/table-names';

// Option types (the disjoint bags)
export type { PortQueueOptions, ShutdownOptions, InstanceOptions } from './options/client-options';
export type { QueueOptions, CreateQueueOptions, ErrorClass } from './options/queue-options';
export type { JobOptions, AddJobOptions, ScheduleOptions, CronSpec } from './options/job-options';
export type {
  BackoffOptions,
  RetentionOptions,
  RetryOptions,
  LimiterOptions,
  SystemLimiterOptions,
  Page,
  PageQuery,
} from './options/common';

// Defaults — every value the tool applies when a caller names none, in one place.
export * from './constants';

// Result & snapshot types
export type {
  AddJobResult,
  JobSnapshot,
  ScheduleInfo,
  QueueInfo,
  InstanceInfo,
  QueueStats,
  GetJobsQuery,
  GetSchedulesQuery,
  GetInstancesQuery,
  GetQueuesQuery,
} from './producer/results';

// Events & hooks types
export type {
  PortQueueEventPayloads,
  EventListener,
  Unsubscribe,
  ErrorSource,
} from './events/event-name.enum';
export type {
  HookRegistration,
  HookHandler,
  BeforeAddResult,
  ProcessOutcome,
} from './events/hooks';

// Driver contract (for custom drivers) + transactions
export type {
  Driver,
  DriverProbe,
  Subscription,
  MigrationStep,
  PageWindow,
  JobListFilter,
  JobRef,
  StalledJobRef,
  RequeuedJobRef,
  ScheduleRef,
  QueueListFilter,
  ScheduleListFilter,
  InstanceListFilter,
} from './drivers/driver.interface';
export type { DriverCapabilitySet } from './drivers/driver-capabilities';
export { capabilities } from './drivers/driver-capabilities';
export { DriverContext } from './drivers/driver-context';
export type { StorageOptions } from './drivers/driver-context';
// The shared driver base: row mapping, value conversion and the affinity scan, for a custom driver
// that wants them. Its SQL is entirely the subclass's own.
export { BaseDriver, JOB_COLUMNS, SCHEDULE_INSERT_COLUMNS } from './drivers/shared/base-driver';
export type { RawResult, Row, Session } from './drivers/shared/base-driver';
export { toMigrationSteps, latestVersion } from './drivers/shared/migration';
export type { FlavourMigration, MigrationNames } from './drivers/shared/migration';
export type { TransactionHandle, TxQueryResult } from './tx/transaction-handle';

// Logging
export type { Logger, LogContext, LoggerOptions } from './logging/logger.interface';

// Errors
export {
  PortQueueError,
  NotStartedError,
  InvalidOptionsError,
  UnsupportedCapabilityError,
  SchemaVersionMismatchError,
  MigrationFailedError,
  DriverConnectionError,
  DriverQueryError,
  QueueNotFoundError,
  QueuePausedError,
  QueueInUseError,
  InstanceActiveError,
  ShutdownTimeoutError,
  MissingPeerDependencyError,
} from './errors/errors';
export type { ErrorContext } from './errors/errors';

/**
 * Internal facade surface for `@portqueue/dashboard` and `@portqueue/cli` (`pq._dashboard` /
 * `pq._cli`). **Not a developer API** — undocumented, unsupported for application code, and free
 * to change in any release. Exported only so those two packages can type their calls. See the
 * facade invariant in CLAUDE.md.
 */
export { JobBatchAction } from './dashboard/dashboard-results';
export type {
  BatchResult,
  DashboardStats,
  DashboardInstancesQuery,
  DashboardQueuesQuery,
  DashboardSchedulesQuery,
  JobInstanceFilter,
  JobSearchQuery,
} from './dashboard/dashboard-results';
export type { DoctorReport } from './cli/cli.service';
