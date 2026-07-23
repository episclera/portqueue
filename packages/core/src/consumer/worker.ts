import { PortQueueEvent } from '../events/event-name.enum.js';
import { RateLimiterService } from '../monitoring/rate-limiter.service.js';
import { ExecutionService, type ExecutionConfig } from './execution.service.js';
import type { CompletionService } from './completion.service.js';
import type { WorkflowService } from './workflow.service.js';
import type { JobHandler, WorkflowStep } from '../jobs/job.js';
import type { ErrorClass } from '../options/worker-options.js';
import type { QueueOptions } from '../options/queue-options.js';
import type { Runtime } from '../client/runtime.js';
import type { RateLimiterOptions } from '../options/common.js';

export interface WorkerConfig {
  queue: string;
  handler?: JobHandler;
  steps?: ReadonlyArray<WorkflowStep>;
  concurrency: number;
  batchSize: number;
  lockDurationMs: number;
  pollIntervalMs: number;
  limiter?: RateLimiterOptions;
  respectSystemPressure: boolean;
  dontAutoretryFor: Array<ErrorClass | string>;
  queueOptions: QueueOptions;
}

/**
 * The consumer for one queue. Owns its own claim loop, heartbeat, and
 * wakeup subscription — queues are independent lanes. A registration,
 * not a control surface: it begins claiming when the client starts and its queue isn't
 * paused, and stops when the client stops. No public methods.
 */
export class Worker {
  private readonly execution: ExecutionService;
  private readonly limiter?: RateLimiterService;
  private activeCount = 0;
  private stopping = false;
  private started = false;
  private queueName: string | null = null;
  private pumping = false;
  private unsubscribeWakeup: (() => void) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly runtime: Runtime,
    completion: CompletionService,
    workflow: WorkflowService,
    private readonly config: WorkerConfig,
    private readonly isPressureHigh: () => boolean,
  ) {
    const execConfig: ExecutionConfig = {
      queueName: config.queue,
      ...(config.handler ? { handler: config.handler } : {}),
      ...(config.steps ? { steps: config.steps } : {}),
      dontAutoretryFor: config.dontAutoretryFor,
      lockDurationMs: config.lockDurationMs,
      queueOptions: config.queueOptions,
    };
    this.execution = new ExecutionService(runtime, completion, workflow, execConfig);
    if (config.limiter) this.limiter = new RateLimiterService(config.limiter, runtime.clock);
  }

  /** @internal Called by the client lifecycle when the client starts. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    const row = await this.runtime.registry.ensure(this.config.queue);
    this.queueName = row.name;
    this.unsubscribeWakeup = this.runtime.wakeup.subscribe(
      this.config.queue,
      () => void this.pump(),
    );
    this.pollTimer = setInterval(() => void this.pump(), this.config.pollIntervalMs);
    this.pollTimer.unref?.();
    this.runtime.events.emit(PortQueueEvent.WORKER_STARTED, { queue: this.config.queue });
    void this.pump();
  }

  /** @internal Number of in-flight handlers (used for graceful drain). */
  get inFlight(): number {
    return this.activeCount;
  }

  /** @internal The execution service (exposes active abort controllers). */
  get executor(): ExecutionService {
    return this.execution;
  }

  private async pump(): Promise<void> {
    if (this.stopping || !this.runtime.isRunning() || this.pumping) return;
    this.pumping = true;
    try {
      while (!this.stopping) {
        const capacity = this.config.concurrency - this.activeCount;
        if (capacity <= 0) break;
        if (this.config.respectSystemPressure && this.isPressureHigh()) break;

        // Observe cluster-wide pause state.
        const row = await this.runtime.registry.refresh(this.config.queue);
        if (row?.processingPaused) break;
        // Observe this instance's own pause state (multi-instance mode).
        if (this.runtime.instances?.processingPaused) break;

        let want = Math.min(capacity, this.config.batchSize);
        if (this.limiter) {
          const granted = this.limiter.take(want);
          if (granted <= 0) break;
          want = granted;
        }

        const jobs = await this.runtime.driver.claimJobs({
          queueName: this.queueName!,
          limit: want,
          lockDurationMs: this.config.lockDurationMs,
          now: this.runtime.clock.now(),
          lockedByInstanceId: this.runtime.identity.id,
          instanceKey: this.runtime.instanceKey,
        });
        if (jobs.length === 0) break;

        for (const record of jobs) {
          this.activeCount += 1;
          void this.execution
            .run(record)
            .catch((err) => {
              this.runtime.events.emit(PortQueueEvent.ERROR, { error: err, source: 'execution' });
            })
            .finally(() => {
              this.activeCount -= 1;
              // A freed slot may allow another claim.
              void this.pump();
            });
        }
      }
    } catch (err) {
      // A DB error mid-claim must never crash the loop.
      this.runtime.events.emit(PortQueueEvent.ERROR, { error: err, source: 'claim' });
    } finally {
      this.pumping = false;
    }
  }

  /** @internal Stop claiming; drain in-flight up to timeout, then abort + release locks. */
  async stop(options: { timeoutMs: number; graceful: boolean }): Promise<void> {
    this.stopping = true;
    if (this.unsubscribeWakeup) this.unsubscribeWakeup();
    if (this.pollTimer) clearInterval(this.pollTimer);

    const deadline = this.runtime.clock.now() + options.timeoutMs;
    if (options.graceful) {
      while (this.activeCount > 0 && this.runtime.clock.now() < deadline) {
        await sleep(25);
      }
    }
    // Abort any still-running handlers and release their locks for fast reclaim.
    for (const [jobId, controller] of this.execution.active) {
      controller.abort();
      void this.runtime.driver
        .extendLock({ jobId, lockDurationMs: -1, now: this.runtime.clock.now() })
        .catch(() => undefined);
    }
    this.started = false;
    this.runtime.events.emit(PortQueueEvent.WORKER_STOPPED, { queue: this.config.queue });
  }

  /** @internal Try to cooperatively cancel an active job on this instance. */
  cancelRunning(jobId: string): boolean {
    const controller = this.execution.active.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
