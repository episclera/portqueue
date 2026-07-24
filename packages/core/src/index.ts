// @portqueue/core — the developer-facing barrel.

// Client, handles, and the Job context type
export { PortQueue } from './port-queue';
export { Queue } from './producer/queue';
export { Worker } from './consumer/worker';
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
export type { QueueOptions } from './options/queue-options';
export type { WorkerOptions, ErrorClass } from './options/worker-options';
export type { JobOptions, AddJobOptions, ScheduleOptions, CronSpec } from './options/job-options';
export type {
  BackoffOptions,
  RetentionOptions,
  RetryOptions,
  LimiterOptions,
  SystemMonitorOptions,
  Page,
} from './options/common';
export type { Duration } from './util/duration';

// Result & snapshot types
export type {
  AddJobResult,
  JobSnapshot,
  ScheduleInfo,
  QueueInfo,
  InstanceInfo,
  QueueStats,
  GetJobsQuery,
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
export type { Driver, DriverProbe, Subscription, MigrationStep } from './drivers/driver.interface';
export type { DriverCapabilitySet } from './drivers/driver-capabilities';
export { capabilities } from './drivers/driver-capabilities';
export { DriverContext } from './drivers/driver-context';
export type { StorageOptions } from './drivers/driver-context';
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
  JobNotFoundError,
  QueuePausedError,
  ShutdownTimeoutError,
  MissingPeerDependencyError,
} from './errors/errors';
