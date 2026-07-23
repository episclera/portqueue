import { JobStatus } from '../jobs/job-state.enum.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
import type { JobRecord, NewJobRecord } from '../jobs/job-record.js';
import type { StepOutcome, WorkflowStep } from '../jobs/job.js';
import type { QueueOptions } from '../options/queue-options.js';
import type { Runtime } from '../client/runtime.js';
import type { ProcessOutcome } from '../events/hooks.js';
import { UnsupportedForWorkerTypeError } from '../errors/errors.js';

/**
 * Workflow (multi-step) dispatch + atomic step advance/spawn. Completing
 * a step and spawning the next happen in one driver transaction (`advanceWorkflowStep`).
 */
export class WorkflowService {
  constructor(private readonly runtime: Runtime) {}

  /** Compute the next step key from the declared order (or an explicit jump). */
  private resolveNextKey(
    currentKey: string,
    steps: ReadonlyArray<WorkflowStep>,
    to?: string,
  ): string | null {
    if (to) {
      if (!steps.some((s) => s.key === to)) {
        throw new UnsupportedForWorkerTypeError(
          `Cannot advance to step '${to}': it is not a declared step of this workflow.`,
        );
      }
      return to;
    }
    const idx = steps.findIndex((s) => s.key === currentKey);
    const next = steps[idx + 1];
    return next ? next.key : null;
  }

  async advance(
    record: JobRecord,
    queueName: string,
    outcome: StepOutcome,
    steps: ReadonlyArray<WorkflowStep>,
    queueOptions: QueueOptions,
  ): Promise<ProcessOutcome> {
    const now = this.runtime.clock.now();
    const currentKey = record.workflowStepKey!;

    if (outcome.kind === 'done') {
      await this.runtime.driver.advanceWorkflowStep({
        jobId: record.id,
        returnValue: outcome.result,
        now,
      });
      this.runtime.events.emit(PortQueueEvent.JOB_STEP_COMPLETED, {
        jobId: record.id,
        queue: queueName,
        workflowId: record.workflowId!,
        stepKey: currentKey,
      });
      this.runtime.events.emit(PortQueueEvent.WORKFLOW_COMPLETED, {
        workflowId: record.workflowId!,
        queue: queueName,
        result: outcome.result,
        lastStepKey: currentKey,
        jobId: record.id,
      });
      return { kind: 'completed', returnValue: outcome.result };
    }

    let nextKey: string | null;
    let carriedData: unknown;
    let startAfter = now;
    if (outcome.kind === 'repeat') {
      nextKey = currentKey;
      carriedData = outcome.data ?? record.data;
      startAfter = now + (outcome.delayMs ?? 0);
    } else {
      nextKey = this.resolveNextKey(currentKey, steps, outcome.to);
      carriedData = outcome.data ?? record.data;
    }

    // No next step (a `next` past the last declared step) → the run is done.
    if (nextKey === null) {
      await this.runtime.driver.advanceWorkflowStep({
        jobId: record.id,
        returnValue: carriedData,
        now,
      });
      this.runtime.events.emit(PortQueueEvent.JOB_STEP_COMPLETED, {
        jobId: record.id,
        queue: queueName,
        workflowId: record.workflowId!,
        stepKey: currentKey,
      });
      this.runtime.events.emit(PortQueueEvent.WORKFLOW_COMPLETED, {
        workflowId: record.workflowId!,
        queue: queueName,
        result: carriedData,
        lastStepKey: currentKey,
        jobId: record.id,
      });
      return { kind: 'completed', returnValue: carriedData };
    }

    // Re-resolve the next step's retry policy from queue defaults (never inherited).
    const resolved = this.runtime.resolver.resolve({
      job: {},
      ...(queueOptions.defaultJobOptions ? { queueDefaults: queueOptions.defaultJobOptions } : {}),
      now,
    });

    const spawn: NewJobRecord = {
      queueName: record.queueName,
      status: JobStatus.PENDING,
      priority: record.priority,
      data: carriedData,
      metadata: record.metadata,
      startAfter,
      expireAt: null,
      retryAttempt: 0,
      retryMaxAttempts: resolved.retryMaxAttempts,
      retryDelayMs: resolved.retryDelayMs,
      retryBackoff: resolved.retryBackoff,
      retryBackoffFactor: resolved.retryBackoffFactor,
      retryMaxDelayMs: resolved.retryMaxDelayMs,
      retryJitter: resolved.retryJitter,
      retentionMode: record.retentionMode,
      retentionTtlMs: record.retentionTtlMs,
      idempotencyKey: null,
      scheduleId: record.scheduleId,
      singletonKey: null,
      workflowId: record.workflowId,
      workflowStepKey: nextKey,
      // Carry affinity forward so a targeted workflow stays on matching instances across steps.
      preferredInstanceKeyPattern: record.preferredInstanceKeyPattern,
      createdAt: now,
    };

    const spawned = await this.runtime.driver.advanceWorkflowStep({
      jobId: record.id,
      returnValue: carriedData,
      now,
      spawn,
    });

    this.runtime.events.emit(PortQueueEvent.JOB_STEP_COMPLETED, {
      jobId: record.id,
      queue: queueName,
      workflowId: record.workflowId!,
      stepKey: currentKey,
      nextStepKey: nextKey,
      ...(spawned ? { nextJobId: spawned.id } : {}),
    });
    // A newly-spawned PENDING job is immediately claimable — wake the loop.
    this.runtime.wakeup.signal(queueName);
    return { kind: 'completed', returnValue: carriedData };
  }
}
