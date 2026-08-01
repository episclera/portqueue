import { MigrationMode } from '../options/enums';
import { PortQueueEvent } from '../events/event-name.enum';
import { SubscriberService } from '../pubsub/subscriber.service';
import { SchedulerService } from '../scheduling/scheduler.service';
import { RetentionService } from '../retention/retention.service';
import { SystemMonitorService, type SystemMetrics } from '../monitoring/system-monitor.service';
import { InstanceService } from './instance.service';
import { MigrationRunner } from '../drivers/shared/migration-runner.service';
import { ShutdownTimeoutError } from '../errors/errors';
import { secondsToMs } from '../util/seconds';
import {
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  DEFAULT_TICK_INTERVAL_SECONDS,
  MIN_SUBSCRIBER_POLL_SECONDS,
} from '../constants';
import type { Runtime } from './runtime';
import type { ClientRegistryService } from './client-registry.service';

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

  /** This process's latest health sample, for the instance heartbeat to persist. */
  get systemMetrics(): SystemMetrics | null {
    return this.monitor?.metrics ?? null;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const { driver, context, options, events, logger, clock } = this.runtime;

    // 1. Connect the driver.
    await driver.connect();
    // 2. Migrate. A headless (admin) client defaults to MANUAL: pointing a dashboard at a database
    //    must never migrate it as a side effect. The CLI's `migrate` command applies them itself.
    const defaultMode = this.runtime.headless ? MigrationMode.MANUAL : MigrationMode.AUTO;
    const migrationRunner = new MigrationRunner(driver, context, logger, events, clock);
    await migrationRunner.run(options.migration ?? defaultMode);

    // A headless client stops here: it reads and administers, but joins nothing. No pub/sub, no
    // maintenance tick, no health monitor, no instance row, no workers.
    if (this.runtime.headless) {
      this.state.running = true;
      events.emit(PortQueueEvent.CLIENT_STARTED, { instanceKey: null });
      return;
    }

    // 3. Pub/sub.
    const tickIntervalSeconds = options.tickIntervalSeconds ?? DEFAULT_TICK_INTERVAL_SECONDS;
    this.subscriber = new SubscriberService(
      driver,
      logger,
      this.runtime.wakeup,
      secondsToMs(
        Math.max(tickIntervalSeconds, MIN_SUBSCRIBER_POLL_SECONDS),
        'tickIntervalSeconds',
      ),
      this.runtime.instanceKey ?? null,
    );
    await this.subscriber.start();

    // 4. Scheduler + retention + monitor, driven by one coordinated tick.
    this.scheduler = new SchedulerService(this.runtime);
    this.retention = new RetentionService(this.runtime);
    // Only sample when something consumes the numbers: the instance heartbeat persists them (so a
    // named client always monitors), and a `systemLimiter` throttles on them. With neither, nobody
    // ever reads a sample and the process was still paying a `setInterval` plus `cpuUsage()` and
    // `getHeapStatistics()` every couple of seconds.
    if (this.runtime.instanceKey || options.systemLimiter) {
      this.monitor = new SystemMonitorService(options.systemLimiter, events, logger, () =>
        this.runtime.wakeup.signalAll(),
      );
      this.monitor.start();
    }
    this.tickTimer = setInterval(
      () => this.runtime.background.run(() => this.tick()),
      secondsToMs(tickIntervalSeconds, 'tickIntervalSeconds'),
    );
    this.tickTimer.unref?.();

    // 5. Multi-instance liveness: register + start heartbeating before workers claim.
    if (this.runtime.instanceKey) {
      const instances = new InstanceService(
        this.runtime,
        this.runtime.instanceKey,
        options.instance?.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        () => this.systemMetrics,
      );
      this.runtime.instances = instances;
      await instances.start();
    }

    // 6. Mark running and start workers.
    this.state.running = true;
    for (const worker of this.registry.allWorkers()) await worker.start();

    events.emit(PortQueueEvent.CLIENT_STARTED, { instanceKey: this.runtime.instanceKey });
    // Run an immediate maintenance tick so due schedules/expiry aren't delayed a full interval.
    this.runtime.background.run(() => this.tick());
  }

  /**
   * One maintenance pass: refresh the cached queue pause flags, fire due schedules, expire and
   * reclaim, then sweep retention.
   *
   * The pause refresh lives here rather than in the claim loop. A worker used to read its queue row
   * on every pump — per poll, and again on every freed concurrency slot — which on an idle queue was
   * more queue reads than job claims. One read per declared queue per tick observes a pause made by
   * another instance within the same interval, at a fraction of the cost.
   */
  private async tick(): Promise<void> {
    if (this.ticking || !this.state.running) return;
    this.ticking = true;
    try {
      await this.runtime.registry.refreshStale();
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
      this.runtime.clock,
    );
    await runner.migrate();
  }

  /**
   * Stop everything in reverse order.
   *
   * Throws {@link ShutdownTimeoutError} when the graceful window elapsed with work still in flight —
   * but only after the shutdown has otherwise completed, so the caller always ends up disconnected. A
   * SIGTERM handler that ignores the rejection still shuts down cleanly; one that logs it learns that
   * handlers were aborted mid-run, which is the thing actually worth knowing.
   */
  async shutdown(options: { graceful: boolean; timeoutSeconds: number }): Promise<void> {
    if (!this.state.running) return;
    const { events } = this.runtime;
    events.emit(PortQueueEvent.CLIENT_STOPPING, { instanceKey: this.runtime.instanceKey });

    // Reverse order.
    if (this.tickTimer) clearInterval(this.tickTimer);
    await this.runtime.instances?.stop();
    await this.subscriber?.stop();
    this.state.running = false; // stop new claims

    // Drain workers.
    for (const worker of this.registry.allWorkers()) {
      await worker.stop({ graceful: options.graceful, timeoutSeconds: options.timeoutSeconds });
    }

    this.monitor?.stop();
    // A tick, pump, heartbeat or NOTIFY fired without an await may still be mid-query. Let it
    // settle before the driver goes away — PGLite frees its WASM heap on disconnect and faults
    // if a query is still running in it.
    const drained = await this.runtime.background.drain(options.timeoutSeconds);
    if (!drained) {
      this.runtime.logger.warn(
        'Background work did not finish within the shutdown timeout; disconnecting anyway.',
      );
    }
    await this.runtime.driver.disconnect();
    events.emit(PortQueueEvent.CLIENT_STOPPED, { instanceKey: this.runtime.instanceKey });
    if (!drained) throw new ShutdownTimeoutError(options.timeoutSeconds);
  }
}
