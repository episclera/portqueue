import { PauseMode } from './options/enums.js';
import { DriverCapability } from './driver/driver-capabilities.js';
import { DriverContext } from './driver/driver-context.js';
import { ConsoleLogger } from './logging/console-logger.js';
import { EventBusService } from './events/event-bus.service.js';
import { HookRunner } from './events/hook-runner.js';
import { InstanceIdentityService } from './client/instance-identity.service.js';
import { OptionResolver } from './options/option-resolver.js';
import { Wakeup } from './pubsub/wakeup.js';
import { QueueRegistry } from './producer/queue-registry.js';
import { NotifierService } from './pubsub/notifier.service.js';
import { ProducerService } from './producer/producer.service.js';
import { ReadService } from './monitoring/stats.service.js';
import { CompletionService } from './consumer/completion.service.js';
import { WorkflowService } from './consumer/workflow.service.js';
import { ClientRegistryService } from './client/client-registry.service.js';
import { ClientLifecycleService } from './client/client-lifecycle.service.js';
import { Queue } from './producer/queue.js';
import { Worker, type WorkerConfig } from './consumer/worker.js';
import { InvalidOptionsError } from './errors/errors.js';
import { SystemClock } from './util/clock.js';
import type { PortQueueOptions, ShutdownOptions } from './options/client-options.js';
import type { QueueOptions } from './options/queue-options.js';
import type { WorkerOptions } from './options/worker-options.js';
import type { WorkflowDefinition } from './jobs/job.js';
import type { Logger } from './logging/logger.interface.js';
import type { Runtime } from './client/runtime.js';
import type { HookRegistration } from './events/hooks.js';
import type { PortQueueEvent, EventListener, Unsubscribe } from './events/event-name.enum.js';
import type {
  GetJobsQuery,
  JobSnapshot,
  Page,
  QueueInfo,
  QueueStats,
  WorkflowSnapshot,
} from './producer/results.js';

/**
 * The top-level client (build_plan/05.2). One per database. Owns connection, migration,
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
      ...(options.tablePrefix !== undefined ? { tablePrefix: options.tablePrefix } : {}),
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    });
    this.events = new EventBusService(logger);
    this.hooks = new HookRunner(logger, this.events);
    const identity = new InstanceIdentityService(options.instance, logger);
    const resolver = new OptionResolver(options.defaultJobOptions, options.retention);
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
      maxPayloadBytes: options.maxPayloadBytes ?? 1024 * 1024,
      namespace: context.namespace,
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

  /** Force-apply migrations (the programmatic MANUAL path; build_plan/04.7). */
  migrate(): Promise<void> {
    return this.lifecycle.migrate();
  }

  // --- Handles ---
  createQueue<TData = unknown>(
    nameOrWorkflow: TQueues | WorkflowDefinition<TData, TQueues>,
    options: QueueOptions = {},
  ): Queue<TData> {
    let name: string;
    if (typeof nameOrWorkflow === 'string') {
      name = nameOrWorkflow;
      this.runtime.registry.define(name, options);
    } else {
      name = nameOrWorkflow.queue;
      this.runtime.registry.define(name, options, nameOrWorkflow as WorkflowDefinition);
    }
    // Register queue-scoped hooks once (build_plan/08.4 — QueueOptions.hooks).
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
    options: WorkerOptions<TData, TResult, TQueues> | WorkflowDefinition<TData, TQueues>,
  ): Worker {
    // A WorkflowDefinition (from defineWorkflow) supplies queue + steps directly.
    const opts: WorkerOptions<TData, TResult, TQueues> =
      'entryStep' in options
        ? ({ queue: options.queue, steps: options.steps } as WorkerOptions<TData, TResult, TQueues>)
        : options;
    const hasHandler = typeof opts.handler === 'function';
    const hasSteps = Array.isArray(opts.steps) && opts.steps.length > 0;
    if (hasHandler === hasSteps) {
      throw new InvalidOptionsError(
        `createWorker for queue '${opts.queue}' requires exactly one of 'handler' (single-function) or 'steps' (workflow).`,
        { queue: opts.queue },
      );
    }
    // Ensure the queue is defined (so pause/resume and options resolve).
    this.runtime.registry.define(opts.queue, this.runtime.registry.getOptions(opts.queue));
    const concurrency = opts.concurrency ?? 1;
    const notifyCapable = this.runtime.driver.capabilities[DriverCapability.LISTEN_NOTIFY];
    const config: WorkerConfig = {
      queue: opts.queue,
      ...(opts.handler
        ? { handler: opts.handler as unknown as NonNullable<WorkerConfig['handler']> }
        : {}),
      ...(opts.steps ? { steps: opts.steps as unknown as NonNullable<WorkerConfig['steps']> } : {}),
      concurrency,
      batchSize: opts.batchSize ?? concurrency,
      lockDurationMs: opts.lockDurationMs ?? 30000,
      pollIntervalMs: opts.pollIntervalMs ?? (notifyCapable ? 5000 : 1000),
      ...(opts.limiter ? { limiter: opts.limiter } : {}),
      respectSystemPressure: opts.respectSystemPressure ?? true,
      dontAutoretryFor: opts.dontAutoretryFor ?? [],
      queueOptions: this.runtime.registry.getOptions(opts.queue),
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

  /** Client-wide stats across all queues (build_plan/10.5 `pq.getStats`). */
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
}

function resolveLogger(logger: PortQueueOptions['logger']): Logger {
  if (logger && typeof (logger as Logger).info === 'function') return logger as Logger;
  return new ConsoleLogger((logger as ConstructorParameters<typeof ConsoleLogger>[0]) ?? {});
}
