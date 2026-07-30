import type { Driver } from '../drivers/driver.interface';
import type { DriverContext } from '../drivers/driver-context';
import type { BackgroundWork } from './background-work';
import type { Logger } from '../logging/logger.interface';
import type { Clock } from '../util/clock';
import type { EventBusService } from '../events/event-bus.service';
import type { HookRunner } from '../events/hook-runner';
import type { InstanceService } from './instance.service';
import type { OptionResolver } from '../options/option-resolver';
import type { PortQueueOptions } from '../options/client-options';
import type { QueueRegistry } from '../producer/queue-registry';
import type { Wakeup } from '../pubsub/wakeup';

/**
 * Per-instance shared singletons (DI is per PortQueue instance, never
 * global). Passed to every service so two PortQueue instances never share state.
 */
export interface Runtime {
  driver: Driver;
  context: DriverContext;
  logger: Logger;
  clock: Clock;
  events: EventBusService;
  hooks: HookRunner;
  resolver: OptionResolver;
  options: PortQueueOptions;
  registry: QueueRegistry;
  wakeup: Wakeup;
  /** Unawaited work in flight (ticks, pumps, heartbeats, NOTIFY), drained before disconnect. */
  background: BackgroundWork;
  /** The multi-instance key for this process, or null when the process is unnamed. */
  instanceKey: string | null;
  /** The heartbeat/liveness service — present only when an `instanceKey` is set. Set during init. */
  instances: InstanceService | null;
  /**
   * True for an admin client (the dashboard or CLI). See `PortQueueOptions._headless`: such a client
   * declares no queues, registers no instance row, and runs no workers or maintenance ticks.
   */
  headless: boolean;
  isRunning(): boolean;
  /** Signal cooperative cancellation of an active job on this instance. */
  cancelRunning?(jobId: string): boolean;
  /** Read-only probe: is this job running in this process right now? */
  isJobRunningHere?(jobId: string): boolean;
}
