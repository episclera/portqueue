import { PauseMode } from './options/enums';
import { PortQueueEvent } from './events/event-name.enum';
import { DriverCapability } from './drivers/driver-capabilities';
import { DriverContext } from './drivers/driver-context';
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
import { WorkflowService } from './consumer/workflow.service';
import { ClientRegistryService } from './client/client-registry.service';
import { ClientLifecycleService } from './client/client-lifecycle.service';
import { Queue } from './producer/queue';
import { Worker, type WorkerConfig } from './consumer/worker';
import { InstanceActiveError, InvalidOptionsError, QueueInUseError } from './errors/errors';
import { SystemClock } from './util/clock';
import { uuid } from './util/uuid';
import type { PortQueueOptions, ShutdownOptions } from './options/client-options';
import type { QueueOptions } from './options/queue-options';
import type { WorkerOptions } from './options/worker-options';
import type { JobHandler, WorkflowStep } from './jobs/job';
import type { Logger } from './logging/logger.interface';
import type { Runtime } from './client/runtime';
import type { HookRegistration } from './events/hooks';
import type { EventListener, Unsubscribe } from './events/event-name.enum';
import type {
  GetJobsQuery,
  InstanceInfo,
  JobSnapshot,
  Page,
  QueueInfo,
  QueueStats,
  WorkflowSnapshot,
} from './producer/results';

/** An instance must be unseen for at least this long before it can be manually removed. */
const INSTANCE_REMOVAL_STALE_MS = 30 * 60_000;

/**
 * The top-level client. One per database. Owns connection, migration,
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
  private readonly workflow: WorkflowService;
  private readonly clientRegistry: ClientRegistryService;
  private readonly lifecycle: ClientLifecycleService;
  private readonly events: EventBusService;
  private readonly hooks: HookRunner;
  private readonly state = { running: false };
  private readonly hookedQueues = new Set<string>();

  constructor(options: PortQueueOptions) {
    if (!options.driver) {
      throw new InvalidOptionsError(
        'PortQueue requires a `driver`. Pass a driver instance, e.g. `new SqliteDriver(...)`.',
      );
    }
    const logger = resolveLogger(options.logger);
    const clock = options.clock ?? new SystemClock();
    const context = new DriverContext({
      ...(options.storage?.tablePrefix !== undefined
        ? { tablePrefix: options.storage.tablePrefix }
        : {}),
      ...(options.storage?.schema !== undefined ? { schema: options.storage.schema } : {}),
      ...(options.storage?.namespace !== undefined
        ? { namespace: options.storage.namespace }
        : {}),
    });
    this.events = new EventBusService(logger);
    this.hooks = new HookRunner(logger, this.events);
    // Lock-owner attribution id. Use the constructor-provided id if given; otherwise a random,
    // ephemeral per-process token. Never derived from the environment (no container/host/IP
    // sniffing). An instance is named solely via `options.instance.key`.
    const identity = { id: options.instance?.id ?? uuid() };
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
      identity,
      resolver,
      options,
      registry,
      wakeup,
      namespace: context.namespace,
      instanceKey: options.instance?.key ?? null,
      instances: null,
      isRunning: () => this.state.running,
      cancelRunning: (jobId: string) => this.clientRegistry.cancelRunning(jobId),
    };

    // Wire the driver's schema/prefix context up front (queries only happen after connect).
    (options.driver as unknown as { setContext?: (c: DriverContext) => void }).setContext?.(
      context,
    );

    const notifier = new NotifierService(
      options.driver,
      logger,
      options.driver.capabilities[DriverCapability.LISTEN_NOTIFY],
    );
    this.producer = new ProducerService(this.runtime, notifier);
    this.reads = new ReadService(this.runtime);
    this.completion = new CompletionService(this.runtime);
    this.workflow = new WorkflowService(this.runtime);
    this.lifecycle = new ClientLifecycleService(this.runtime, this.clientRegistry, this.state);
  }

  // --- Lifecycle ---
  async init(): Promise<void> {
    await this.lifecycle.init();
  }

  async shutdown(options: ShutdownOptions = {}): Promise<void> {
    await this.lifecycle.shutdown({
      graceful: options.graceful ?? true,
      timeoutMs: options.timeoutMs ?? 30000,
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
  createQueue<TData = unknown>(
    name: TQueues,
    options: QueueOptions = {},
  ): Queue<TData> {
    this.runtime.registry.define(name, options);
    // Register queue-scoped hooks once (QueueOptions.hooks).
    if (options.hooks && !this.hookedQueues.has(name)) {
      this.hookedQueues.add(name);
      for (const hook of options.hooks) {
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
    // The handler is either a single function (simple mode) or an ordered array of
    // workflow steps (workflow mode). There is no separate workflow-definition object.
    let handler: JobHandler | undefined;
    let steps: ReadonlyArray<WorkflowStep> | undefined;
    if (Array.isArray(options.handler)) {
      steps = validateWorkflowSteps(options.queue, options.handler as ReadonlyArray<WorkflowStep>);
    } else if (typeof options.handler === 'function') {
      handler = options.handler as unknown as JobHandler;
    } else {
      throw new InvalidOptionsError(
        `createWorker for queue '${options.queue}' requires 'handler' to be a function (simple job) or a non-empty array of steps (workflow).`,
        { queue: options.queue },
      );
    }
    // A workflow worker registers its steps so the producer mints workflow jobs
    // (workflowId + entry step) when adding to this queue.
    this.runtime.registry.define(
      options.queue,
      this.runtime.registry.getOptions(options.queue),
      steps,
    );
    const limiter = options.limiter ?? {};
    const concurrency = limiter.concurrency ?? 1;
    const notifyCapable = this.runtime.driver.capabilities[DriverCapability.LISTEN_NOTIFY];
    const rate =
      limiter.rateMax != null && limiter.rateDuration != null
        ? { max: limiter.rateMax, duration: limiter.rateDuration }
        : null;
    const config: WorkerConfig = {
      queue: options.queue,
      ...(handler ? { handler } : {}),
      ...(steps ? { steps } : {}),
      concurrency,
      batchSize: limiter.batchSize ?? concurrency,
      lockDurationMs: limiter.lockDurationMs ?? 30000,
      pollIntervalMs: limiter.pollIntervalMs ?? (notifyCapable ? 5000 : 1000),
      ...(rate ? { limiter: rate } : {}),
      respectSystemPressure: limiter.respectSystemPressure ?? false,
      dontAutoretryFor: options.dontAutoretryFor ?? [],
      queueOptions: this.runtime.registry.getOptions(options.queue),
    };
    const worker = new Worker(
      this.runtime,
      this.completion,
      this.workflow,
      config,
      () => this.lifecycle.systemPressureHigh,
    );
    this.clientRegistry.addWorker(worker);
    if (this.state.running) void worker.start();
    return worker;
  }

  // --- Cross-cutting reads ---
  getQueues(): Promise<QueueInfo[]> {
    return this.reads.getQueues();
  }

  getQueueStats(options: { queue?: TQueues } = {}): Promise<QueueStats> {
    return this.reads.getQueueStats(options.queue);
  }

  /** Client-wide stats across all queues (`pq.getStats`). */
  getStats(): Promise<QueueStats> {
    return this.reads.getQueueStats();
  }

  getJob<TData = unknown>(options: { jobId: string }): Promise<JobSnapshot<TData> | null> {
    return this.reads.getJob<TData>(options.jobId);
  }

  getJobs<TData = unknown>(options: GetJobsQuery = {}): Promise<Page<JobSnapshot<TData>>> {
    return this.reads.getJobs<TData>(options);
  }

  getWorkflow(options: { workflowId: string }): Promise<WorkflowSnapshot | null> {
    return this.reads.getWorkflow(options.workflowId);
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
    await this.createQueue(options.queue).pause(options.mode ? { mode: options.mode } : {});
  }
  async resumeQueue(options: { queue: TQueues }): Promise<void> {
    await this.createQueue(options.queue).resume();
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
  /** All known instances with liveness + per-instance job attribution (for the dashboard/CLI). */
  getInstances(): Promise<InstanceInfo[]> {
    return this.reads.getInstances();
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
    if (row.lastSeenAt >= now - INSTANCE_REMOVAL_STALE_MS) {
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

/**
 * Validate a workflow worker's steps: non-empty, non-empty keys, and
 * unique keys. Returns the same array so it can be registered/stored as the canonical
 * ordered sequence (`steps[0]` is the entry step).
 */
function validateWorkflowSteps(
  queue: string,
  steps: ReadonlyArray<WorkflowStep>,
): ReadonlyArray<WorkflowStep> {
  if (steps.length === 0) {
    throw new InvalidOptionsError(
      `Workflow worker for queue '${queue}' must declare at least one step (an ordered array of { key, handler }).`,
      { queue },
    );
  }
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.key) {
      throw new InvalidOptionsError(
        `Workflow worker for queue '${queue}' has a step with an empty key.`,
        { queue },
      );
    }
    if (seen.has(step.key)) {
      throw new InvalidOptionsError(
        `Workflow worker for queue '${queue}' has a duplicate step key '${step.key}'. Step keys must be unique.`,
        { queue },
      );
    }
    seen.add(step.key);
  }
  return steps;
}
