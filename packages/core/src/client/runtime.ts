import type { Driver } from '../driver/driver.interface.js';
import type { DriverContext } from '../driver/driver-context.js';
import type { Logger } from '../logging/logger.interface.js';
import type { Clock } from '../util/clock.js';
import type { EventBusService } from '../events/event-bus.service.js';
import type { HookRunner } from '../events/hook-runner.js';
import type { InstanceIdentityService } from './instance-identity.service.js';
import type { InstanceService } from './instance.service.js';
import type { OptionResolver } from '../options/option-resolver.js';
import type { PortQueueOptions } from '../options/client-options.js';
import type { QueueRegistry } from '../producer/queue-registry.js';
import type { Wakeup } from '../pubsub/wakeup.js';

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
  identity: InstanceIdentityService;
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
