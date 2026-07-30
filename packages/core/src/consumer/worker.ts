import { PortQueueEvent } from '../events/event-name.enum';
import { RateLimiterService } from '../monitoring/rate-limiter.service';
import { ExecutionService, type ExecutionConfig } from './execution.service';
import { secondsToMs } from '../util/seconds';
import { DRAIN_POLL_SECONDS } from '../constants';
import type { CompletionService } from './completion.service';
import type { JobHandler } from '../jobs/job';
import type { ErrorClass } from '../options/queue-options';
import type { Runtime } from '../client/runtime';

/** Worker wiring, resolved from the consumer half of `CreateQueueOptions`. Every duration is seconds. */
export interface WorkerConfig {
  queue: string;
  handler: JobHandler;
  concurrency: number;
  batchSize: number;
  lockDurationSeconds: number;
  pollIntervalSeconds: number;
  limiter?: { max: number; durationSeconds: number };
  dontAutoretryFor: Array<ErrorClass | string>;
}

/**
 * The consumer for one queue. Owns its own claim loop, heartbeat, and
 * wakeup subscription — queues are independent lanes.
 *
 * **Internal.** There is no developer-facing worker: `pq.createQueue({ name, handler })` builds one
 * of these behind the queue's declaration, and it is never handed out. It begins claiming when the
 * client starts and its queue isn't paused, and stops when the client stops — so there was never a
 * lifecycle method to expose in the first place.
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
  /** A one-shot timer scheduled for the moment the rate limiter will have a token again. */
  private tokenTimer: NodeJS.Timeout | null = null;

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
      secondsToMs(this.config.pollIntervalSeconds, 'limiter.pollIntervalSeconds'),
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

        // Cluster-wide pause state, from the registry's cache — no query on the hot path. The
        // maintenance tick refreshes it, and a pause made in this process updates it immediately.
        if (this.runtime.registry.pauseState(this.config.queue)?.processingPaused) break;
        // This instance's own pause state (multi-instance mode).
        if (this.runtime.instances?.processingPaused) break;

        let want = Math.min(capacity, this.config.batchSize);
        if (this.limiter) {
          const granted = this.limiter.take(want);
          if (granted <= 0) {
            // Out of tokens. Come back when the bucket refills rather than waiting for the poll
            // timer — otherwise a rate-limited worker idles for a whole `pollIntervalSeconds` after
            // a shortfall that may clear in milliseconds.
            this.scheduleTokenWakeup(this.limiter.msUntilAvailable());
            break;
          }
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

  /** Re-pump once the rate limiter has a token. At most one such timer is ever outstanding. */
  private scheduleTokenWakeup(delayMs: number): void {
    if (this.tokenTimer || this.stopping) return;
    this.tokenTimer = setTimeout(
      () => {
        this.tokenTimer = null;
        if (!this.stopping) this.runtime.background.run(() => this.pump());
      },
      Math.max(delayMs, 0),
    );
    this.tokenTimer.unref?.();
  }

  /** @internal Stop claiming; drain in-flight up to timeout, then abort + release locks. */
  async stop(options: { timeoutSeconds: number; graceful: boolean }): Promise<void> {
    this.stopping = true;
    if (this.unsubscribeWakeup) this.unsubscribeWakeup();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.tokenTimer = null;

    if (options.graceful && this.activeCount > 0) {
      // Raced against a real timer rather than measured with the injected clock. The drain waits on
      // wall-clock time — the handlers really are running — so a deadline taken from a clock a test
      // controls would never arrive and this would spin for as long as the handlers took.
      await Promise.race([
        this.awaitIdle(),
        elapses(secondsToMs(options.timeoutSeconds, 'shutdown timeoutSeconds')),
      ]);
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

  /** Resolve once the last in-flight handler has settled. */
  private async awaitIdle(): Promise<void> {
    const pollMs = secondsToMs(DRAIN_POLL_SECONDS, 'drain poll');
    while (this.activeCount > 0) await elapses(pollMs);
  }

  /** @internal Try to cooperatively cancel an active job on this instance. */
  cancelRunning(jobId: string): boolean {
    const controller = this.execution.active.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}

/** A promise that resolves once `ms` has passed, on a timer that never holds the loop open. */
function elapses(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(ms, 0));
    timer.unref?.();
  });
}
