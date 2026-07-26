import { PortQueueEvent } from '../events/event-name.enum';
import { RateLimiterService } from '../monitoring/rate-limiter.service';
import { ExecutionService, type ExecutionConfig } from './execution.service';
import type { CompletionService } from './completion.service';
import type { JobHandler } from '../jobs/job';
import type { ErrorClass } from '../options/worker-options';
import type { QueueOptions } from '../options/queue-options';
import type { Runtime } from '../client/runtime';

/** Worker wiring, resolved from `WorkerOptions`. Every duration is seconds. */
export interface WorkerConfig {
  queue: string;
  handler: JobHandler;
  concurrency: number;
  batchSize: number;
  lockDurationSeconds: number;
  pollIntervalSeconds: number;
  limiter?: { max: number; durationSeconds: number };
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
    private readonly config: WorkerConfig,
    private readonly isPressureHigh: () => boolean,
  ) {
    const execConfig: ExecutionConfig = {
      queueName: config.queue,
      handler: config.handler,
      dontAutoretryFor: config.dontAutoretryFor,
      lockDurationSeconds: config.lockDurationSeconds,
      queueOptions: config.queueOptions,
    };
    this.execution = new ExecutionService(runtime, completion, execConfig);
    if (config.limiter) this.limiter = new RateLimiterService(config.limiter, runtime.clock);
  }

  /** @internal Called by the client lifecycle when the client starts. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    const row = await this.runtime.registry.ensure(this.config.queue);
    this.queueName = row.name;
    this.unsubscribeWakeup = this.runtime.wakeup.subscribe(this.config.queue, () =>
      this.runtime.background.run(() => this.pump()),
    );
    this.pollTimer = setInterval(
      () => this.runtime.background.run(() => this.pump()),
      this.config.pollIntervalSeconds * 1000,
    );
    this.pollTimer.unref?.();
    this.runtime.events.emit(PortQueueEvent.WORKER_STARTED, { queue: this.config.queue });
    this.runtime.background.run(() => this.pump());
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
        // Pressure is only ever high when the client was given a `systemLimiter`; without one this
        // reads false forever, which is why there is no per-worker opt-in to carry.
        if (this.isPressureHigh()) break;

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
          lockDurationSeconds: this.config.lockDurationSeconds,
          now: this.runtime.clock.now(),
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
              this.runtime.background.run(() => this.pump());
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
  async stop(options: { timeoutSeconds: number; graceful: boolean }): Promise<void> {
    this.stopping = true;
    if (this.unsubscribeWakeup) this.unsubscribeWakeup();
    if (this.pollTimer) clearInterval(this.pollTimer);

    const deadline = this.runtime.clock.now() + options.timeoutSeconds * 1000;
    if (options.graceful) {
      while (this.activeCount > 0 && this.runtime.clock.now() < deadline) {
        await sleep(25);
      }
    }
    // Abort any still-running handlers and release their locks for fast reclaim.
    for (const [jobId, controller] of this.execution.active) {
      controller.abort();
      this.runtime.background.run(() =>
        this.runtime.driver.extendLock({
          jobId,
          lockDurationSeconds: -1,
          now: this.runtime.clock.now(),
        }),
      );
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
