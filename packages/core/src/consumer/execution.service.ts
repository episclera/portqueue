import { PortQueueEvent } from '../events/event-name.enum';
import { secondsToMs } from '../util/seconds';
import { LOCK_HEARTBEATS_PER_WINDOW, MIN_LOCK_HEARTBEAT_SECONDS } from '../constants';
import type { Job, JobHandler } from '../jobs/job';
import type { JobRecord } from '../jobs/job-record';
import type { ErrorClass } from '../options/worker-options';
import type { QueueOptions } from '../options/queue-options';
import type { Runtime } from '../client/runtime';
import type { CompletionService } from './completion.service';

export interface ExecutionConfig {
  queueName: string;
  handler: JobHandler;
  dontAutoretryFor: Array<ErrorClass | string>;
  lockDurationSeconds: number;
  queueOptions: QueueOptions;
}

/**
 * Runs handlers, catches every error, and routes to retry/fail. A throw never
 * propagates to the claim loop. Each job runs under a heartbeat that
 * extends the lock and an AbortSignal fired on shutdown/cooperative-cancel.
 */
export class ExecutionService {
  /** Active jobs on this instance → their abort controllers (for cancel/shutdown). */
  readonly active = new Map<string, AbortController>();

  constructor(
    private readonly runtime: Runtime,
    private readonly completion: CompletionService,
    private readonly config: ExecutionConfig,
  ) {}

  async run(record: JobRecord): Promise<void> {
    const startTs = this.runtime.clock.now();
    const controller = new AbortController();
    this.active.set(record.id, controller);
    const queueName = this.config.queueName;

    this.runtime.events.emit(PortQueueEvent.JOB_ACTIVE, {
      jobId: record.id,
      queue: queueName,
      retryAttempt: record.retryAttempt,
      instanceKey: this.runtime.instanceKey,
    });

    const job = this.buildJob(record, controller.signal);
    const heartbeat = this.startHeartbeat(record.id, controller);

    try {
      await this.runtime.hooks.runBeforeProcess(queueName, job);
      const returnValue = await this.config.handler(job);
      const outcome = await this.completion.complete(record, queueName, returnValue, startTs);
      await this.runtime.hooks.runAfterProcess(queueName, job, outcome);
    } catch (err) {
      const outcome = await this.completion.failOrRetry(
        record,
        queueName,
        err,
        this.config.dontAutoretryFor,
      );
      await this.runtime.hooks.runAfterProcess(queueName, job, outcome).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      this.active.delete(record.id);
    }
  }

  private buildJob(record: JobRecord, signal: AbortSignal): Job {
    const runtime = this.runtime;
    const lockDurationSeconds = this.config.lockDurationSeconds;
    return {
      id: record.id,
      queue: this.config.queueName,
      data: record.data,
      retryAttempt: record.retryAttempt,
      retryMaxAttempts: record.retryMaxAttempts,
      priority: record.priority,
      createdAt: new Date(record.createdAt),
      startAfter: new Date(record.startAfter),
      ...(record.scheduleId ? { scheduleId: record.scheduleId } : {}),
      ...(record.idempotencyKey ? { idempotencyKey: record.idempotencyKey } : {}),
      signal,
      async extendLock(options = {}) {
        await runtime.driver.extendLock({
          jobId: record.id,
          lockDurationSeconds: options.bySeconds ?? lockDurationSeconds,
          now: runtime.clock.now(),
        });
      },
    };
  }

  private startHeartbeat(jobId: string, controller: AbortController): NodeJS.Timeout {
    // Beat at a fraction of the lock window, never faster than the floor, so a lock is renewed
    // several times before it could lapse.
    const intervalMs = Math.max(
      secondsToMs(MIN_LOCK_HEARTBEAT_SECONDS, 'lock heartbeat floor'),
      Math.floor(
        secondsToMs(this.config.lockDurationSeconds, 'limiter.lockDurationSeconds') /
          LOCK_HEARTBEATS_PER_WINDOW,
      ),
    );
    const timer = setInterval(async () => {
      try {
        const held = await this.runtime.driver.extendLock({
          jobId,
          lockDurationSeconds: this.config.lockDurationSeconds,
          now: this.runtime.clock.now(),
        });
        if (!held && !controller.signal.aborted) controller.abort();
      } catch {
        /* transient DB error — next tick retries */
      }
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}
