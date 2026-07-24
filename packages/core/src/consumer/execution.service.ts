import { PortQueueEvent } from '../events/event-name.enum';
import type { Job, JobHandler, StepController, StepOutcome, WorkflowStep } from '../jobs/job';
import type { JobRecord } from '../jobs/job-record';
import type { ErrorClass } from '../options/worker-options';
import type { QueueOptions } from '../options/queue-options';
import type { Runtime } from '../client/runtime';
import type { CompletionService } from './completion.service';
import type { WorkflowService } from './workflow.service';
import { UnsupportedForWorkerTypeError } from '../errors/errors';

export interface ExecutionConfig {
  queueName: string;
  handler?: JobHandler;
  steps?: ReadonlyArray<WorkflowStep>;
  dontAutoretryFor: Array<ErrorClass | string>;
  lockDurationMs: number;
  queueOptions: QueueOptions;
}

/**
 * Runs handlers, catches every error, and routes to retry/fail/step-advance. A throw never
 * propagates to the claim loop. Each job runs under a heartbeat that
 * extends the lock and an AbortSignal fired on shutdown/cooperative-cancel.
 */
export class ExecutionService {
  /** Active jobs on this instance → their abort controllers (for cancel/shutdown). */
  readonly active = new Map<string, AbortController>();

  constructor(
    private readonly runtime: Runtime,
    private readonly completion: CompletionService,
    private readonly workflow: WorkflowService,
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
      let outcome;
      if (this.config.steps) {
        outcome = await this.runStep(record, job);
      } else {
        const returnValue = await this.config.handler!(job);
        outcome = await this.completion.complete(record, queueName, returnValue, startTs);
      }
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

  private async runStep(
    record: JobRecord,
    job: Job,
  ): Promise<import('../events/hooks').ProcessOutcome> {
    const steps = this.config.steps!;
    const step = steps.find((s) => s.key === record.workflowStepKey);
    if (!step) {
      throw new UnsupportedForWorkerTypeError(
        `Workflow job for queue '${this.config.queueName}' names step '${record.workflowStepKey}', which this worker does not declare.`,
        { queue: this.config.queueName },
      );
    }
    const controller: StepController = {
      next: (options = {}) => ({ kind: 'next', ...options }) as StepOutcome,
      repeat: (options = {}) => ({ kind: 'repeat', ...options }) as StepOutcome,
      done: (options = {}) => ({ kind: 'done', ...options }) as StepOutcome,
    };
    const outcome = await step.handler(job, controller);
    return this.workflow.advance(
      record,
      this.config.queueName,
      outcome,
      steps,
      this.config.queueOptions,
    );
  }

  private buildJob(record: JobRecord, signal: AbortSignal): Job {
    const runtime = this.runtime;
    const lockDurationMs = this.config.lockDurationMs;
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
      ...(record.workflowId ? { workflowId: record.workflowId } : {}),
      ...(record.workflowStepKey ? { workflowStepKey: record.workflowStepKey } : {}),
      signal,
      async extendLock(options = {}) {
        await runtime.driver.extendLock({
          jobId: record.id,
          lockDurationMs: options.byMs ?? lockDurationMs,
          now: runtime.clock.now(),
        });
      },
    };
  }

  private startHeartbeat(jobId: string, controller: AbortController): NodeJS.Timeout {
    const interval = Math.max(1000, Math.floor(this.config.lockDurationMs / 3));
    const timer = setInterval(async () => {
      try {
        const held = await this.runtime.driver.extendLock({
          jobId,
          lockDurationMs: this.config.lockDurationMs,
          now: this.runtime.clock.now(),
        });
        if (!held && !controller.signal.aborted) controller.abort();
      } catch {
        /* transient DB error — next tick retries */
      }
    }, interval);
    timer.unref?.();
    return timer;
  }
}
