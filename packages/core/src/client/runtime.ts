import type { Driver } from '../drivers/driver.interface';
import type { DriverContext } from '../drivers/driver-context';
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
  /** Lock-owner attribution id (constructor-provided or a random per-process token; never env-derived). */
  identity: { readonly id: string };
  resolver: OptionResolver;
  options: PortQueueOptions;
  registry: QueueRegistry;
  wakeup: Wakeup;
  maxPayloadBytes: number;
  namespace: string;
  /** The multi-instance key for this process, or null in single-instance mode. */
  instanceKey: string | null;
  /** The heartbeat/liveness service — present only in multi-instance mode. Set during init. */
  instances: InstanceService | null;
  isRunning(): boolean;
  /** Signal cooperative cancellation of an active job on this instance. */
  cancelRunning?(jobId: string): boolean;
}
