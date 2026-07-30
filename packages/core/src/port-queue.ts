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
import { JobStatus } from './jobs/job-state.enum';
import {
  InstanceActiveError,
  InvalidOptionsError,
  NotStartedError,
  QueueInUseError,
  QueueNotFoundError,
} from './errors/errors';
import { SystemClock } from './util/clock';
import { secondsToMs } from './util/seconds';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_LOCK_DURATION_SECONDS,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEFAULT_SHUTDOWN_TIMEOUT_SECONDS,
  DEFAULT_TICK_INTERVAL_SECONDS,
  INSTANCE_REMOVAL_STALE_SECONDS,
} from './constants';
import type { PortQueueOptions, ShutdownOptions } from './options/client-options';
import type { CreateQueueOptions, ErrorClass } from './options/queue-options';
import type { LimiterOptions } from './options/common';
import type { AddJobOptions } from './options/job-options';
import type { JobHandler } from './jobs/job';
import type { Logger } from './logging/logger.interface';
import type { Runtime } from './client/runtime';
import type { HookRegistration } from './events/hooks';
import type { TransactionHandle } from './tx/transaction-handle';
import type { QueueRow } from './jobs/job-record';
import type { EventListener, Unsubscribe } from './events/event-name.enum';
import type {
  AddJobResult,
  GetInstancesQuery,
  GetJobsQuery,
  GetQueuesQuery,
  GetSchedulesQuery,
  InstanceInfo,
  JobSnapshot,
  Page,
  QueueInfo,
  QueueStats,
  ScheduleInfo,
} from './producer/results';

/**
 * The top-level client, and **the whole developer-facing surface**. Owns connection, migration,
 * shared services, and the queue declarations. A thin facade — all real work lives in focused
 * services. Construction wires dependencies only; no I/O until `init()`.
 *
 * Every operation lives here rather than on the handle `createQueue` returns: that is a registration
 * with no methods (see {@link Queue}). A per-queue operation takes `queue` as a named argument, so one
 * import reaches every queue and no read can silently escape the scope its handle implied. There is
 * also no `createWorker`: one `createQueue` call declares a queue *and*, if it carries a `handler`,
 * consumes it.
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
  private readonly headless: boolean;

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
    this.headless = options._headless === true;
    if (this.headless && options.instance?.instanceKey) {
      throw new InvalidOptionsError(
        'A headless PortQueue (the dashboard or CLI) cannot take an `instance.instanceKey`. An ' +
          'admin client is anonymous: it registers no instance row, so naming it would put a ' +
          'heartbeat in the instances list for a process that never claims a job.',
      );
    }
    const logger = resolveLogger(options.logger);
    const clock = options.clock ?? new SystemClock();
    const context = options.driver.context;
    this.events = new EventBusService(logger);
    this.hooks = new HookRunner(logger, this.events);
    const resolver = new OptionResolver();
    const wakeup = new Wakeup();
    const registry = new QueueRegistry(options.driver, clock, {
      tickIntervalSeconds: options.tickIntervalSeconds ?? DEFAULT_TICK_INTERVAL_SECONDS,
      headless: this.headless,
    });
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
      // A headless client is anonymous by construction — no instance row, no affinity, no pause.
      instanceKey: this.headless ? null : (options.instance?.instanceKey ?? null),
      instances: null,
      headless: this.headless,
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
    this._dashboard = new DashboardService(this.runtime, this.reads, this.producer);
    this._cli = new CliService(this.runtime, this.producer);
  }

  // --- Lifecycle ---
  async init(): Promise<void> {
    await this.lifecycle.init();
  }

  async shutdown(options: ShutdownOptions = {}): Promise<void> {
    await this.lifecycle.shutdown({
      graceful: options.graceful ?? true,
      timeoutSeconds: options.timeoutSeconds ?? DEFAULT_SHUTDOWN_TIMEOUT_SECONDS,
    });
  }

  get isRunning(): boolean {
    return this.state.running;
  }

  /** Force-apply migrations (the programmatic MANUAL path). */
  migrate(): Promise<void> {
    return this.lifecycle.migrate();
  }

  // --- Registrations ---
  /**
   * Declare a queue in this process — **everything about it, in one call**: the `handler` that
   * processes its jobs, the `limiter` / `dontAutoretryFor` settings that shape how it claims them, and
   * the `defaultJobOptions`, `retention` and `hooks` its jobs inherit.
   *
   * The handler is required: declaring a queue *is* declaring that this process consumes it. A process
   * that only enqueues declares nothing — {@link addJob} addresses a queue by name and creates its row
   * on first use, so an API tier can produce onto a queue its worker tier consumes.
   *
   * The returned {@link Queue} carries the name and the payload type and nothing else — every
   * operation is a method on this class.
   *
   * A queue is declared **once per process**: a second call for the same name throws, because two
   * handlers would run two claim loops over the same rows. This is also the only thing that records
   * queue options, and nothing internal calls it — `pauseQueue`, `getJobs`, the dashboard and the CLI
   * all address a queue by name — so an admin action can never blank the defaults a declaration set.
   *
   * On a headless client (the dashboard or CLI) this declares nothing, writes nothing and consumes
   * nothing; it only hands back a typed name.
   */
  createQueue<TData = unknown, TResult = unknown>(
    options: CreateQueueOptions<TData, TResult, TQueues>,
  ): Queue<TData> {
    const { name, handler, limiter, dontAutoretryFor, ...queueOptions } = options;
    // Every rule about the *call* is checked before anything is recorded: a rejected declaration
    // must not have replaced the queue's options or its hooks on its way to throwing.
    if (typeof handler !== 'function') {
      throw new InvalidOptionsError(
        `createQueue for queue '${name}' requires 'handler' to be a function — a queue is declared ` +
          `by the process that processes it. To only enqueue, skip createQueue and call ` +
          `pq.addJob({ queue: '${name}', data }), which creates the queue's row on first use.`,
        { queue: name },
      );
    }
    if (this.clientRegistry.hasWorker(name)) {
      throw new InvalidOptionsError(
        `Queue '${name}' already has a handler in this process. A queue is consumed by at most ` +
          `one handler per process — two claim loops over the same rows only compete for them. ` +
          `Raise 'limiter.concurrency' to process more jobs at once, or run another instance.`,
        { queue: name },
      );
    }
    if ((limiter?.rateMax == null) !== (limiter?.rateDurationSeconds == null)) {
      throw new InvalidOptionsError(
        `createQueue for queue '${name}' set only one half of the rate cap. ` +
          `'limiter.rateMax' and 'limiter.rateDurationSeconds' define one setting — how many jobs ` +
          `may start per window — so either both are given or neither is.`,
        { queue: name },
      );
    }
    this.runtime.registry.declare(name, queueOptions);
    if (!this.headless) {
      // Reached at most once per queue: the handler check above rejects a second declaration, so
      // these hooks can never stack duplicates onto every add.
      for (const hook of queueOptions.hooks ?? []) {
        this.hooks.register(hook.queue ? hook : { ...hook, queue: name });
      }
      this.startConsuming(name, handler as JobHandler, limiter, dontAutoretryFor);
    }
    const existing = this.clientRegistry.getQueue(name) as Queue<TData> | undefined;
    if (existing) return existing;
    const queue = new Queue<TData>(name);
    this.clientRegistry.addQueue(name, queue as Queue<unknown>);
    return queue;
  }

  /**
   * Build the claim loop behind a queue that declared a `handler`, and start it if the client is
   * already running. Internal: there is no worker on the public surface, so nothing is handed back.
   */
  private startConsuming(
    queue: string,
    handler: JobHandler,
    limiterOptions: LimiterOptions = {},
    dontAutoretryFor: Array<ErrorClass | string> = [],
  ): void {
    const limiter = limiterOptions;
    const concurrency = limiter.concurrency ?? DEFAULT_CONCURRENCY;
    const rate =
      limiter.rateMax != null && limiter.rateDurationSeconds != null
        ? { max: limiter.rateMax, durationSeconds: limiter.rateDurationSeconds }
        : null;
    const config: WorkerConfig = {
      queue,
      handler,
      concurrency,
      batchSize: limiter.batchSize ?? concurrency,
      lockDurationSeconds: limiter.lockDurationSeconds ?? DEFAULT_LOCK_DURATION_SECONDS,
      // LISTEN/NOTIFY-capable engines wake instantly on new jobs and only fall back to polling as a
      // safety net; non-notify engines poll on this cadence. Lower it via
      // `limiter.pollIntervalSeconds` for snappier pickup.
      pollIntervalSeconds: limiter.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
      ...(rate ? { limiter: rate } : {}),
      dontAutoretryFor,
    };
    const worker = new Worker(
      this.runtime,
      this.completion,
      config,
      () => this.lifecycle.systemPressureHigh,
    );
    this.clientRegistry.addWorker(queue, worker);
    if (this.state.running) void worker.start();
  }

  // --- Producing ---
  /** Add one job to a queue (or create a recurring schedule, with `schedule.cron`/`startEverySeconds`). */
  addJob<TData = unknown>(
    options: AddJobOptions<TData> & { queue: TQueues | string },
  ): Promise<AddJobResult> {
    this.requireStarted('addJob');
    const { queue, ...jobOptions } = options;
    return this.producer.addJob<TData>(queue, jobOptions as AddJobOptions<TData>);
  }

  /**
   * Add many one-off jobs to one queue in a **single** insert — one round trip for the whole batch
   * rather than two per job. Results come back in the order the jobs were given. Recurring entries
   * are rejected: each recurrence needs its own {@link addJob} so its result can carry a `scheduleId`.
   */
  addJobs<TData = unknown>(options: {
    queue: TQueues | string;
    jobs: Array<AddJobOptions<TData>>;
  }): Promise<AddJobResult[]> {
    this.requireStarted('addJobs');
    return this.producer.addJobs<TData>(options.queue, options.jobs);
  }

  // --- Reads ---
  /** A page of queues with their per-status counts, plus the total across every page. */
  getQueues(options: GetQueuesQuery = {}): Promise<Page<QueueInfo>> {
    this.requireStarted('getQueues');
    return this.reads.getQueues(options);
  }

  /** One queue by name, with the same counts and `inUse` flag the list carries. */
  getQueue(options: { name: TQueues | string }): Promise<QueueInfo | null> {
    this.requireStarted('getQueue');
    return this.reads.getQueue(options.name);
  }

  getQueueStats(options: { queue?: TQueues } = {}): Promise<QueueStats> {
    this.requireStarted('getQueueStats');
    return this.reads.getQueueStats(options.queue);
  }

  /** Client-wide stats across every queue — the same shape `getQueueStats` returns for one. */
  getQueuesStats(): Promise<QueueStats> {
    this.requireStarted('getQueuesStats');
    return this.reads.getQueueStats();
  }

  /** One job by id, from any queue. */
  getJob<TData = unknown>(options: { jobId: string }): Promise<JobSnapshot<TData> | null> {
    this.requireStarted('getJob');
    return this.reads.getJob<TData>(options.jobId);
  }

  /** A page of jobs, newest first. Narrow with `queue`, `statuses` or `scheduleId`. */
  getJobs<TData = unknown>(
    options: GetJobsQuery & { queue?: TQueues | string } = {},
  ): Promise<Page<JobSnapshot<TData>>> {
    this.requireStarted('getJobs');
    return this.reads.getJobs<TData>(options);
  }

  /** A page of recurring schedules — one queue's with `queue`, every queue's without it. */
  getSchedules(
    options: GetSchedulesQuery & { queue?: TQueues | string } = {},
  ): Promise<Page<ScheduleInfo>> {
    this.requireStarted('getSchedules');
    return this.producer.getSchedules(options);
  }

  /** One schedule by id, with the queue it produces onto. Null if unknown. */
  getSchedule(options: { scheduleId: string }): Promise<ScheduleInfo | null> {
    this.requireStarted('getSchedule');
    return this.producer.getSchedule(options.scheduleId);
  }

  // --- Job control ---
  /**
   * Requeue a **settled** job to run again — its own row is re-armed with its persisted data (status
   * back to `PENDING`, retry counters, lock, return value and timestamps reset). To start a fresh
   * run instead, add a new job with {@link addJob}.
   *
   * A **running** job is never re-armed: clearing its lock would let a second worker claim it while
   * the first handler is still going, so an `ACTIVE` job — like an unknown id — returns `null`.
   * Cancel it first with {@link cancelJob} and retry once it has settled.
   */
  async retryJob(options: { jobId: string; tx?: TransactionHandle }): Promise<AddJobResult | null> {
    this.requireStarted('retryJob');
    const requeued = await this.runtime.driver.requeueJob({
      jobId: options.jobId,
      now: this.runtime.clock.now(),
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (!requeued) return null;
    this.runtime.wakeup.signal(requeued.queueName);
    this.events.emit(PortQueueEvent.JOB_ADDED, {
      jobId: requeued.jobId,
      queue: requeued.queueName,
      deduplicated: false,
    });
    return {
      jobId: requeued.jobId,
      queue: requeued.queueName,
      status: requeued.status,
      startAfter: new Date(requeued.startAfter),
      deduplicated: false,
    };
  }

  /**
   * Cancel a job. If the job is **currently running in this process**, its handler's `AbortSignal` is
   * fired for cooperative cancellation (the handler must honour `job.signal` to actually stop) and
   * that settles the row. Otherwise a pending/delayed job is marked `CANCELLED` so it never runs.
   * Returns true if either path acted.
   */
  async cancelJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean> {
    this.requireStarted('cancelJob');
    // A locally-running handler owns its row's outcome — fire its signal and let it settle,
    // rather than racing a DB write against its completion.
    if (this.runtime.cancelRunning?.(options.jobId)) return true;
    const cancelled = await this.runtime.driver.cancelJob({
      jobId: options.jobId,
      now: this.runtime.clock.now(),
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (!cancelled) return false;
    this.events.emit(PortQueueEvent.JOB_CANCELLED, {
      jobId: cancelled.jobId,
      queue: cancelled.queueName,
    });
    return true;
  }

  /**
   * Remove a single job's row. Never removes a **running** job: an `ACTIVE` row is skipped and this
   * returns `false` without touching it — cancel it first with {@link cancelJob}, then remove it once
   * it has settled.
   */
  async removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean> {
    this.requireStarted('removeJob');
    const removed = await this.runtime.driver.removeJob({
      jobId: options.jobId,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (!removed) return false;
    this.events.emit(PortQueueEvent.JOB_REMOVED, {
      jobId: removed.jobId,
      queue: removed.queueName,
    });
    return true;
  }

  /**
   * Remove many jobs — either a set of ids (from any queue) or every job on one queue in the given
   * statuses. Returns how many rows went away.
   *
   * `ACTIVE` is refused both ways: by id an active row is skipped, and by status it throws, because
   * deleting a running job's row would yank it out from under its handler.
   */
  async removeJobs(
    options: ({ jobIds: string[] } | { queue: TQueues | string; statuses: JobStatus[] }) & {
      tx?: TransactionHandle;
    },
  ): Promise<number> {
    this.requireStarted('removeJobs');
    if ('jobIds' in options) {
      const removed = await this.runtime.driver.removeJobs({
        jobIds: options.jobIds,
        ...(options.tx ? { tx: options.tx } : {}),
      });
      for (const ref of removed) {
        this.events.emit(PortQueueEvent.JOB_REMOVED, {
          jobId: ref.jobId,
          queue: ref.queueName,
        });
      }
      return removed.length;
    }
    if (options.statuses.includes(JobStatus.ACTIVE)) {
      throw new InvalidOptionsError(
        `Cannot remove jobs by status ACTIVE on queue '${options.queue}': an ACTIVE job is ` +
          `running. Cancel it first with cancelJob({ jobId }), then remove it once it has settled.`,
        { queue: options.queue },
      );
    }
    return this.runtime.driver.removeJobsByStatus({
      queueName: options.queue,
      statuses: options.statuses,
      ...(options.tx ? { tx: options.tx } : {}),
    });
  }

  /** Remove a recurring schedule by id. Returns true when a schedule went away. */
  async removeSchedule(options: { scheduleId: string; tx?: TransactionHandle }): Promise<boolean> {
    this.requireStarted('removeSchedule');
    const removed = await this.runtime.driver.deleteSchedule({
      scheduleId: options.scheduleId,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (!removed) return false;
    this.events.emit(PortQueueEvent.SCHEDULE_REMOVED, {
      scheduleId: removed.scheduleId,
      queue: removed.queueName,
    });
    return true;
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

  // --- Queue control (persisted, cluster-wide) ---
  /**
   * Stop workers everywhere from claiming this queue's jobs. With `mode: PauseMode.ALL` the queue
   * also refuses new jobs.
   *
   * This flips the queue row's two flags and touches nothing else — in particular it does **not**
   * re-declare the queue, so it can never overwrite the default job options or retention policy a
   * `createQueue` registered. A queue this process declared is created first if it has not produced
   * anything yet (its row is written lazily); a name nothing has ever used throws
   * {@link QueueNotFoundError} rather than conjuring a paused queue no code consumes.
   */
  async pauseQueue(options: { queue: TQueues | string; mode?: PauseMode }): Promise<void> {
    this.requireStarted('pauseQueue');
    const mode = options.mode ?? PauseMode.PROCESSING;
    const row = await this.setPaused(options.queue, true, mode === PauseMode.ALL);
    if (row) this.runtime.registry.update(row);
    this.events.emit(PortQueueEvent.QUEUE_PAUSED, { queue: options.queue, mode });
  }

  /** Resume claiming (and accepting) on this queue. See {@link pauseQueue} for what it touches. */
  async resumeQueue(options: { queue: TQueues | string }): Promise<void> {
    this.requireStarted('resumeQueue');
    const row = await this.setPaused(options.queue, false, false);
    if (row) this.runtime.registry.update(row);
    this.runtime.wakeup.signal(options.queue);
    this.events.emit(PortQueueEvent.QUEUE_RESUMED, { queue: options.queue });
  }

  /**
   * Write both pause flags, returning the updated row so the cached flags this process's workers
   * read are refreshed without a second query.
   */
  private async setPaused(
    queue: string,
    processingPaused: boolean,
    acceptingPaused: boolean,
  ): Promise<QueueRow | null> {
    // A queue declared here may not have written its row yet (it is created on first use), so
    // ensure it before pausing. `ensure` only creates the row; it never writes queue options.
    if (this.runtime.registry.isRegistered(queue)) await this.runtime.registry.ensure(queue);
    const row = await this.runtime.driver.setQueuePaused({
      queueName: queue,
      processingPaused,
      acceptingPaused,
      now: this.runtime.clock.now(),
    });
    if (!row) throw new QueueNotFoundError(queue);
    return row;
  }

  /**
   * Manually remove a queue's row from the database. Refuses if the queue is still declared in
   * *this* process (via `createQueue`) — a running process must not have its queue deleted from
   * under it. The tool never removes queues automatically; this is an admin action
   * for queues no longer used by any running code. Job rows link by name (no FK) and are untouched.
   */
  async removeQueue(options: { name: TQueues | string }): Promise<boolean> {
    this.requireStarted('removeQueue');
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
    this.requireStarted('getInstances');
    return this.reads.getInstances(options);
  }

  /** One instance by key, with the same liveness, health and attribution the list carries. */
  getInstance(options: { instanceKey: string }): Promise<InstanceInfo | null> {
    this.requireStarted('getInstance');
    return this.reads.getInstance(options.instanceKey);
  }

  /** Stop the named instance from claiming jobs (persisted; the target picks it up on heartbeat). */
  async pauseInstance(options: { instanceKey: string }): Promise<void> {
    this.requireStarted('pauseInstance');
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
    this.requireStarted('resumeInstance');
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
    this.requireStarted('removeInstance');
    const row = await this.runtime.driver.getInstance({ instanceKey: options.instanceKey });
    if (!row) return false;
    const now = this.runtime.clock.now();
    const staleAfterMs = secondsToMs(
      INSTANCE_REMOVAL_STALE_SECONDS,
      'instance removal staleness window',
    );
    if (row.lastSeenAt >= now - staleAfterMs) {
      throw new InstanceActiveError(options.instanceKey);
    }
    const ok = await this.runtime.driver.deleteInstance({ instanceKey: options.instanceKey });
    if (ok) this.events.emit(PortQueueEvent.INSTANCE_REMOVED, { instanceKey: options.instanceKey });
    return ok;
  }

  /**
   * Every method that touches the database goes through this first. Before `init()` the driver is
   * not connected, and the failure the caller used to get was whatever the driver said about its own
   * connection — which named neither the mistake nor the fix.
   */
  private requireStarted(method: string): void {
    if (!this.state.running) throw new NotStartedError(method);
  }
}

function resolveLogger(logger: PortQueueOptions['logger']): Logger {
  if (logger && typeof (logger as Logger).info === 'function') return logger as Logger;
  return new ConsoleLogger((logger as ConstructorParameters<typeof ConsoleLogger>[0]) ?? {});
}
