import { PauseMode } from './options/enums';
import { PortQueueEvent } from './events/event-name.enum';
import { DriverCapability } from './drivers/driver-capabilities';
import { ConsoleLogger } from './logging/console-logger';
import { EventBusService } from './events/event-bus.service';
import { HookRunner } from './events/hook-runner';
import { OptionResolver } from './options/option-resolver';
import { Wakeup } from './pubsub/wakeup';
import { QueueRegistry } from './producer/queue-registry';
import { NotifierService } from './pubsub/notifier.service';
import { ProducerService } from './producer/producer.service';
import { ReadService } from './monitoring/stats.service';
import { CompletionService } from './consumer/completion.service';
import { ClientRegistryService } from './client/client-registry.service';
import { ClientLifecycleService } from './client/client-lifecycle.service';
import { BackgroundWork } from './client/background-work';
import { DashboardService } from './dashboard/dashboard.service';
import { CliService } from './cli/cli.service';
import { Queue } from './producer/queue';
import { Worker, type WorkerConfig } from './consumer/worker';
import { InstanceActiveError, InvalidOptionsError, QueueInUseError } from './errors/errors';
import { SystemClock } from './util/clock';
import type { PortQueueOptions, ShutdownOptions } from './options/client-options';
import type { CreateQueueOptions } from './options/queue-options';
import type { WorkerOptions } from './options/worker-options';
import type { JobHandler } from './jobs/job';
import type { Logger } from './logging/logger.interface';
import type { Runtime } from './client/runtime';
import type { HookRegistration } from './events/hooks';
import type { EventListener, Unsubscribe } from './events/event-name.enum';
import type {
  GetInstancesQuery,
  GetJobsQuery,
  GetQueuesQuery,
  InstanceInfo,
  JobSnapshot,
  Page,
  QueueInfo,
  QueueStats,
} from './producer/results';

/** An instance must be unseen for at least this long (seconds) before it can be manually removed. */
const INSTANCE_REMOVAL_STALE_SECONDS = 30 * 60;

/**
 * The top-level client. Owns connection, migration,
 * shared services, and produces Queue/Worker handles. A thin facade — all real work lives
 * in focused services. Construction wires dependencies only; no I/O until `init()`.
 *
 * @typeParam TQueues - an optional string enum/union of this app's queue names, threaded
 * through every queue-name argument for compile-time safety (defaults to `string`).
 */
export class PortQueue<TQueues extends string = string> {
  private readonly runtime: Runtime;
  private readonly producer: ProducerService;
  private readonly reads: ReadService;
  private readonly completion: CompletionService;
  private readonly clientRegistry: ClientRegistryService;
  private readonly lifecycle: ClientLifecycleService;
  private readonly events: EventBusService;
  private readonly hooks: HookRunner;
  private readonly state = { running: false };
  private readonly hookedQueues = new Set<string>();

  /**
   * Internal facade for `@portqueue/dashboard`. **Not a developer API** — it is undocumented,
   * unsupported for application code, and free to change in any release. Its purpose is to keep
   * the dashboard's needs off the public surface: when the dashboard wants something this class
   * doesn't already document, the method goes here rather than on `PortQueue`.
   */
  readonly _dashboard: DashboardService;

  /**
   * Internal facade for `@portqueue/cli`, with the same contract as {@link _dashboard}.
   */
  readonly _cli: CliService;

  constructor(options: PortQueueOptions) {
    if (!options.driver) {
      throw new InvalidOptionsError(
        'PortQueue requires a `driver`. Pass a driver instance, e.g. `new SqliteDriver(...)`.',
      );
    }
    const logger = resolveLogger(options.logger);
    const clock = options.clock ?? new SystemClock();
    const context = options.driver.context;
    this.events = new EventBusService(logger);
    this.hooks = new HookRunner(logger, this.events);
    const resolver = new OptionResolver();
    const wakeup = new Wakeup();
    const registry = new QueueRegistry(options.driver, clock);
    this.clientRegistry = new ClientRegistryService();

    this.runtime = {
      driver: options.driver,
      context,
      logger,
      clock,
      events: this.events,
      hooks: this.hooks,
      resolver,
      options,
      registry,
      wakeup,
      background: new BackgroundWork(),
      instanceKey: options.instance?.instanceKey ?? null,
      instances: null,
      isRunning: () => this.state.running,
      cancelRunning: (jobId: string) => this.clientRegistry.cancelRunning(jobId),
      isJobRunningHere: (jobId: string) => this.clientRegistry.isRunning(jobId),
    };

    const notifier = new NotifierService(
      options.driver,
      logger,
      options.driver.capabilities[DriverCapability.LISTEN_NOTIFY],
    );
    this.producer = new ProducerService(this.runtime, notifier);
    this.reads = new ReadService(this.runtime);
    this.completion = new CompletionService(this.runtime);
    this.lifecycle = new ClientLifecycleService(this.runtime, this.clientRegistry, this.state);
    this._dashboard = new DashboardService(this.runtime, this.reads);
    this._cli = new CliService(this.runtime);
  }

  // --- Lifecycle ---
  async init(): Promise<void> {
    await this.lifecycle.init();
  }

  async shutdown(options: ShutdownOptions = {}): Promise<void> {
    await this.lifecycle.shutdown({
      graceful: options.graceful ?? true,
      timeoutSeconds: options.timeoutSeconds ?? 30,
    });
  }

  get isRunning(): boolean {
    return this.state.running;
  }

  /** Force-apply migrations (the programmatic MANUAL path). */
  migrate(): Promise<void> {
    return this.lifecycle.migrate();
  }

  // --- Handles ---
  createQueue<TData = unknown>(options: CreateQueueOptions<TQueues>): Queue<TData> {
    const { name, ...queueOptions } = options;
    this.runtime.registry.define(name, queueOptions);
    // Register queue-scoped hooks once (QueueOptions.hooks).
    if (queueOptions.hooks && !this.hookedQueues.has(name)) {
      this.hookedQueues.add(name);
      for (const hook of queueOptions.hooks) {
        this.hooks.register(hook.queue ? hook : { ...hook, queue: name });
      }
    }
    const existing = this.clientRegistry.getQueue(name) as Queue<TData> | undefined;
    if (existing) return existing;
    const queue = new Queue<TData>(name, this.producer, this.reads, this.runtime);
    this.clientRegistry.addQueue(name, queue as Queue<unknown>);
    return queue;
  }

  createWorker<TData = unknown, TResult = unknown>(
    options: WorkerOptions<TData, TResult, TQueues>,
  ): Worker {
    if (typeof options.handler !== 'function') {
      throw new InvalidOptionsError(
        `createWorker for queue '${options.queue}' requires 'handler' to be a function.`,
        { queue: options.queue },
      );
    }
    const handler = options.handler as unknown as JobHandler;
    this.runtime.registry.define(options.queue, this.runtime.registry.getOptions(options.queue));
    const limiter = options.limiter ?? {};
    const concurrency = limiter.concurrency ?? 1;
    const rate =
      limiter.rateMax != null && limiter.rateDurationSeconds != null
        ? { max: limiter.rateMax, durationSeconds: limiter.rateDurationSeconds }
        : null;
    const config: WorkerConfig = {
      queue: options.queue,
      handler,
      concurrency,
      batchSize: limiter.batchSize ?? concurrency,
      lockDurationSeconds: limiter.lockDurationSeconds ?? 30,
      // Default poll cadence is 5 seconds for every driver. LISTEN/NOTIFY-capable engines wake
      // instantly on new jobs and only fall back to polling as a safety net; non-notify engines
      // poll on this same cadence. Lower it via `limiter.pollIntervalSeconds` for snappier pickup.
      pollIntervalSeconds: limiter.pollIntervalSeconds ?? 5,
      ...(rate ? { limiter: rate } : {}),
      dontAutoretryFor: options.dontAutoretryFor ?? [],
      queueOptions: this.runtime.registry.getOptions(options.queue),
    };
    const worker = new Worker(
      this.runtime,
      this.completion,
      config,
      () => this.lifecycle.systemPressureHigh,
    );
    this.clientRegistry.addWorker(worker);
    if (this.state.running) void worker.start();
    return worker;
  }

  // --- Cross-cutting reads ---
  /** A page of queues with their per-status counts, plus the total across every page. */
  getQueues(options: GetQueuesQuery = {}): Promise<Page<QueueInfo>> {
    return this.reads.getQueues(options);
  }

  /** One queue by name, with the same counts and `inUse` flag the list carries. */
  getQueue(options: { name: TQueues | string }): Promise<QueueInfo | null> {
    return this.reads.getQueue(options.name);
  }

  getQueueStats(options: { queue?: TQueues } = {}): Promise<QueueStats> {
    return this.reads.getQueueStats(options.queue);
  }

  /** Client-wide stats across every queue — the same shape `getQueueStats` returns for one. */
  getQueuesStats(): Promise<QueueStats> {
    return this.reads.getQueueStats();
  }

  getJob<TData = unknown>(options: { jobId: string }): Promise<JobSnapshot<TData> | null> {
    return this.reads.getJob<TData>(options.jobId);
  }

  getJobs<TData = unknown>(options: GetJobsQuery = {}): Promise<Page<JobSnapshot<TData>>> {
    return this.reads.getJobs<TData>(options);
  }

  // --- Events & hooks ---
  on<E extends PortQueueEvent>(
    event: E,
    listener: EventListener<E>,
    filter?: { queue?: TQueues },
  ): Unsubscribe {
    return this.events.on(event, listener, filter);
  }
  once<E extends PortQueueEvent>(
    event: E,
    listener: EventListener<E>,
    filter?: { queue?: TQueues },
  ): Unsubscribe {
    return this.events.once(event, listener, filter);
  }
  off<E extends PortQueueEvent>(event: E, listener: EventListener<E>): void {
    this.events.off(event, listener);
  }
  useHook(hook: HookRegistration): Unsubscribe {
    return this.hooks.register(hook);
  }

  // --- Direct queue control (convenience; also on Queue) ---
  async pauseQueue(options: { queue: TQueues; mode?: PauseMode }): Promise<void> {
    await this.createQueue({ name: options.queue }).pause(
      options.mode ? { mode: options.mode } : {},
    );
  }
  async resumeQueue(options: { queue: TQueues }): Promise<void> {
    await this.createQueue({ name: options.queue }).resume();
  }

  /**
   * Manually remove a queue's row from the database. Refuses if the queue is still declared in
   * *this* process (via createQueue/createWorker) — a running process must not have its queue
   * deleted from under it. The tool never removes queues automatically; this is an admin action
   * for queues no longer used by any running code. Job rows link by name (no FK) and are untouched.
   */
  async removeQueue(options: { name: TQueues | string }): Promise<boolean> {
    if (this.runtime.registry.isRegistered(options.name)) {
      throw new QueueInUseError(options.name);
    }
    const ok = await this.runtime.driver.deleteQueue({ name: options.name });
    if (ok) this.events.emit(PortQueueEvent.QUEUE_REMOVED, { queue: options.name });
    return ok;
  }

  // --- Instances (multi-instance mode) ---
  /** A page of known instances with liveness + per-instance job attribution, plus the total. */
  getInstances(options: GetInstancesQuery = {}): Promise<Page<InstanceInfo>> {
    return this.reads.getInstances(options);
  }

  /** One instance by key, with the same liveness, health and attribution the list carries. */
  getInstance(options: { instanceKey: string }): Promise<InstanceInfo | null> {
    return this.reads.getInstance(options.instanceKey);
  }

  /** Stop the named instance from claiming jobs (persisted; the target picks it up on heartbeat). */
  async pauseInstance(options: { instanceKey: string }): Promise<void> {
    await this.runtime.driver.setInstancePaused({
      instanceKey: options.instanceKey,
      processingPaused: true,
      now: this.runtime.clock.now(),
    });
    // If pausing ourselves, reflect it immediately rather than waiting for the next beat.
    if (this.runtime.instances?.instanceKey === options.instanceKey) {
      await this.runtime.instances.beat();
    }
    this.events.emit(PortQueueEvent.INSTANCE_PAUSED, { instanceKey: options.instanceKey });
  }

  /** Resume the named instance's job claiming. */
  async resumeInstance(options: { instanceKey: string }): Promise<void> {
    await this.runtime.driver.setInstancePaused({
      instanceKey: options.instanceKey,
      processingPaused: false,
      now: this.runtime.clock.now(),
    });
    if (this.runtime.instances?.instanceKey === options.instanceKey) {
      await this.runtime.instances.beat();
    }
    this.runtime.wakeup.signalAll();
    this.events.emit(PortQueueEvent.INSTANCE_RESUMED, { instanceKey: options.instanceKey });
  }

  /**
   * Manually remove a long-inactive instance's monitoring row. Refuses unless the instance has not
   * heartbeat for at least 30 minutes (a live or recently-seen instance would just re-register on
   * its next beat). Jobs record the processing instance key as a plain string (no FK), so removal
   * never touches job rows — it only tidies the instances list. The tool never does this itself.
   */
  async removeInstance(options: { instanceKey: string }): Promise<boolean> {
    const row = await this.runtime.driver.getInstance({ instanceKey: options.instanceKey });
    if (!row) return false;
    const now = this.runtime.clock.now();
    if (row.lastSeenAt >= now - INSTANCE_REMOVAL_STALE_SECONDS * 1000) {
      throw new InstanceActiveError(options.instanceKey);
    }
    const ok = await this.runtime.driver.deleteInstance({ instanceKey: options.instanceKey });
    if (ok) this.events.emit(PortQueueEvent.INSTANCE_REMOVED, { instanceKey: options.instanceKey });
    return ok;
  }
}

function resolveLogger(logger: PortQueueOptions['logger']): Logger {
  if (logger && typeof (logger as Logger).info === 'function') return logger as Logger;
  return new ConsoleLogger((logger as ConstructorParameters<typeof ConsoleLogger>[0]) ?? {});
}
