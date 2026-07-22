// @portqueue/core — the developer-facing barrel (build_plan/05.7).

// Client, handles, and the Job context type
export { PortQueue } from './port-queue.js';
export { Queue } from './producer/queue.js';
export { Worker } from './consumer/worker.js';
export type {
  Job,
  JobHandler,
  StepHandler,
  StepController,
  StepOutcome,
  WorkflowStep,
} from './jobs/job.js';

// Enums (no magic strings)
export { JobStatus } from './jobs/job-state.enum.js';
export {
  BackoffStrategy,
  RetryMode,
  PauseMode,
  DeduplicationReason,
  RetentionMode,
  MigrationMode,
  DatabaseEngine,
  InstanceType,
} from './options/enums.js';
export { PortQueueEvent } from './events/event-name.enum.js';
export { HookPhase } from './events/hooks.js';
export { LogLevel } from './logging/log-level.enum.js';
export { PortQueueErrorCode } from './errors/error-codes.enum.js';
export { DriverCapability } from './driver/driver-capabilities.js';

// Option types (the disjoint bags)
export type { PortQueueOptions, ShutdownOptions } from './options/client-options.js';
export type { QueueOptions } from './options/queue-options.js';
export type { WorkerOptions, ErrorClass } from './options/worker-options.js';
export type { JobOptions, AddJobOptions, CronSpec } from './options/job-options.js';
export type {
  BackoffOptions,
  RetentionOptions,
  RateLimiterOptions,
  JobMetadata,
  InstanceIdentityOptions,
  SystemMonitorOptions,
  Page,
} from './options/common.js';
export type { Duration } from './util/duration.js';
export { duration } from './util/duration.js';

// Result & snapshot types
export type {
  AddJobResult,
  JobSnapshot,
  WorkflowSnapshot,
  ScheduleInfo,
  QueueInfo,
  QueueStats,
  GetJobsQuery,
} from './producer/results.js';

// Events & hooks types
export type {
  PortQueueEventPayloads,
  EventListener,
  Unsubscribe,
  ErrorSource,
} from './events/event-name.enum.js';
export type {
  HookRegistration,
  HookHandler,
  BeforeAddResult,
  ProcessOutcome,
} from './events/hooks.js';

// Driver contract (for custom drivers) + transactions
export type {
  Driver,
  DriverProbe,
  Subscription,
  MigrationStep,
} from './driver/driver.interface.js';
export type { DriverCapabilitySet } from './driver/driver-capabilities.js';
export { capabilities } from './driver/driver-capabilities.js';
export { DriverContext } from './driver/driver-context.js';
export type { TransactionHandle, TxQueryResult } from './tx/transaction-handle.js';

// Logging
export type { Logger, LogContext, LoggerOptions } from './logging/logger.interface.js';
export { ConsoleLogger, NoopLogger } from './logging/console-logger.js';

// Errors
export {
  PortQueueError,
  NotStartedError,
  InvalidOptionsError,
  UnsupportedCapabilityError,
  UnsupportedForWorkerTypeError,
  SchemaVersionMismatchError,
  MigrationFailedError,
  DriverConnectionError,
  DriverQueryError,
  JobNotFoundError,
  QueuePausedError,
  PayloadTooLargeError,
  ShutdownTimeoutError,
  MissingPeerDependencyError,
} from './errors/errors.js';
