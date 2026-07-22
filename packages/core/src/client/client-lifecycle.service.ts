import { MigrationMode } from '../options/enums.js';
import { DriverCapability } from '../driver/driver-capabilities.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
import { SubscriberService } from '../pubsub/subscriber.service.js';
import { SchedulerService } from '../scheduling/scheduler.service.js';
import { RetentionService } from '../retention/retention.service.js';
import { SystemMonitorService } from '../monitoring/system-monitor.service.js';
import { InstanceService } from './instance.service.js';
import { MigrationRunner } from '../schema/migration/migration-runner.service.js';
import type { Runtime } from './runtime.js';
import type { ClientRegistryService } from './client-registry.service.js';

interface Mutable {
  running: boolean;
}

/**
 * Owns the strict ordered startup and reverse-ordered shutdown.
 */
export class ClientLifecycleService {
  private subscriber: SubscriberService | null = null;
  private scheduler: SchedulerService | null = null;
  private retention: RetentionService | null = null;
  private monitor: SystemMonitorService | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private initialized = false;

  constructor(
    private readonly runtime: Runtime,
    private readonly registry: ClientRegistryService,
    private readonly state: Mutable,
  ) {}

  get systemPressureHigh(): boolean {
    return this.monitor?.pressureHigh ?? false;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const { driver, context, options, events, logger } = this.runtime;

    // 2. Connect the driver.
    await driver.connect();
    // 3. Migrate.
    (driver as unknown as { setContext?: (c: typeof context) => void }).setContext?.(context);
    await driver.ensureBaseObjects({ context });
    const migrationRunner = new MigrationRunner(driver, context, logger, events);
    await migrationRunner.run(options.migration ?? MigrationMode.AUTO);

    // 4. Pub/sub.
    const tickInterval = options.tickIntervalMs ?? 5000;
    this.subscriber = new SubscriberService(
      driver,
      logger,
      this.runtime.wakeup,
      Math.max(tickInterval, 5000),
    );
    await this.subscriber.start();

    // 5/6. Scheduler + retention + monitor, driven by one coordinated tick.
    this.scheduler = new SchedulerService(this.runtime);
    this.retention = new RetentionService(this.runtime);
    if (options.monitor !== false) {
      this.monitor = new SystemMonitorService(
        options.monitor ?? { maxEventLoopDelayMs: 200, sampleIntervalMs: 2000 },
        events,
        logger,
        () => this.runtime.wakeup.signalAll(),
      );
      this.monitor.start();
    }
    this.tickTimer = setInterval(() => void this.tick(), tickInterval);
    this.tickTimer.unref?.();

    // 6b. Multi-instance liveness: register + start heartbeating before workers claim.
    if (this.runtime.instanceKey) {
      const instances = new InstanceService(
        this.runtime,
        this.runtime.instanceKey,
        options.instanceHeartbeatIntervalMs ?? 15000,
      );
      this.runtime.instances = instances;
      await instances.start();
    }

    // 7. Mark running and start workers.
    this.state.running = true;
    for (const worker of this.registry.allWorkers()) await worker.start();

    events.emit(PortQueueEvent.CLIENT_STARTED, { instanceId: this.runtime.identity.id });
    // Run an immediate maintenance tick so due schedules/expiry aren't delayed a full interval.
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.ticking || !this.state.running) return;
    this.ticking = true;
    try {
      await this.scheduler?.tick();
      await this.retention?.sweep();
    } catch (err) {
      this.runtime.events.emit(PortQueueEvent.ERROR, { error: err, source: 'scheduler' });
    } finally {
      this.ticking = false;
    }
  }

  async migrate(): Promise<void> {
    const runner = new MigrationRunner(
      this.runtime.driver,
      this.runtime.context,
      this.runtime.logger,
      this.runtime.events,
    );
    await runner.migrate();
  }

  async shutdown(options: { graceful: boolean; timeoutMs: number }): Promise<void> {
    if (!this.state.running) return;
    const { events } = this.runtime;
    events.emit(PortQueueEvent.CLIENT_STOPPING, { instanceId: this.runtime.identity.id });

    // Reverse order.
    if (this.tickTimer) clearInterval(this.tickTimer);
    await this.runtime.instances?.stop();
    await this.subscriber?.stop();
    this.state.running = false; // stop new claims

    // Drain workers.
    for (const worker of this.registry.allWorkers()) {
      await worker.stop({ graceful: options.graceful, timeoutMs: options.timeoutMs });
    }

    this.monitor?.stop();
    await this.runtime.driver.disconnect();
    events.emit(PortQueueEvent.CLIENT_STOPPED, { instanceId: this.runtime.identity.id });
  }

  /** Whether the driver can push notifications (drives the notifier). */
  get notifyCapable(): boolean {
    return this.runtime.driver.capabilities[DriverCapability.LISTEN_NOTIFY];
  }
}
