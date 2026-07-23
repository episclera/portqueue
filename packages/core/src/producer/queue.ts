import { PauseMode, RetryMode } from '../options/enums.js';
import { PortQueueEvent } from '../events/event-name.enum.js';
import { JobNotFoundError } from '../errors/errors.js';
import type { AddJobOptions } from '../options/job-options.js';
import type {
  AddJobResult,
  GetJobsQuery,
  JobSnapshot,
  Page,
  QueueStats,
  ScheduleInfo,
} from './results.js';
import type { JobStatus } from '../jobs/job-state.enum.js';
import type { ProducerService } from './producer.service.js';
import type { ReadService } from '../monitoring/stats.service.js';
import type { Runtime } from '../client/runtime.js';
import type { TransactionHandle } from '../tx/transaction-handle.js';

/**
 * The producer handle for one queue. Add/schedule/inspect/control jobs.
 * Getting a Queue does no I/O beyond lazily ensuring the queue is registered.
 */
export class Queue<TData = unknown> {
  constructor(
    readonly name: string,
    private readonly producer: ProducerService,
    private readonly reads: ReadService,
    private readonly runtime: Runtime,
  ) {}

  // --- Adding jobs (one-off and recurring) ---
  addJob(options: AddJobOptions<TData>): Promise<AddJobResult> {
    return this.producer.addJob(this.name, options);
  }

  addJobs(options: { jobs: AddJobOptions<TData>[] }): Promise<AddJobResult[]> {
    return this.producer.addJobs(this.name, options.jobs);
  }

  getSchedules(): Promise<ScheduleInfo[]> {
    return this.producer.getSchedules(this.name);
  }

  // --- Inspection (scoped to this queue) ---
  getJob(options: { jobId: string }): Promise<JobSnapshot<TData> | null> {
    return this.reads.getJob<TData>(options.jobId);
  }

  getJobs(options: GetJobsQuery = {}): Promise<Page<JobSnapshot<TData>>> {
    return this.reads.getJobs<TData>({ ...options, queue: this.name });
  }

  getQueueStats(): Promise<QueueStats> {
    return this.reads.getQueueStats(this.name);
  }

  // --- Job control ---
  async retryJob(options: { jobId: string; from?: RetryMode }): Promise<AddJobResult> {
    const from = options.from ?? RetryMode.FROM_FAILED_STEP;
    const inserted = await this.runtime.driver.requeueJob({
      jobId: options.jobId,
      from,
      now: this.runtime.clock.now(),
    });
    this.runtime.wakeup.signal(this.name);
    return {
      jobId: inserted.id,
      queue: this.name,
      status: inserted.status,
      startAfter: new Date(inserted.startAfter),
      deduplicated: false,
      ...(inserted.workflowId ? { workflowId: inserted.workflowId } : {}),
    };
  }

  async cancelJob(options: { jobId: string }): Promise<boolean> {
    const ok = await this.runtime.driver.cancelJob({
      jobId: options.jobId,
      now: this.runtime.clock.now(),
    });
    if (ok)
      this.runtime.events.emit(PortQueueEvent.JOB_CANCELLED, {
        jobId: options.jobId,
        queue: this.name,
      });
    return ok;
  }

  /** Request cooperative cancellation of an active job by firing its signal. */
  async cancelRunningJob(options: { jobId: string }): Promise<boolean> {
    return this.runtime.cancelRunning?.(options.jobId) ?? false;
  }

  async removeJob(options: { jobId: string; tx?: TransactionHandle }): Promise<boolean> {
    const ok = await this.runtime.driver.removeJob({
      jobId: options.jobId,
      ...(options.tx ? { tx: options.tx } : {}),
    });
    if (ok)
      this.runtime.events.emit(PortQueueEvent.JOB_REMOVED, {
        jobId: options.jobId,
        queue: this.name,
      });
    return ok;
  }

  async removeSchedule(options: { scheduleId: string }): Promise<boolean> {
    const ok = await this.runtime.driver.deleteSchedule({ scheduleId: options.scheduleId });
    if (ok)
      this.runtime.events.emit(PortQueueEvent.SCHEDULE_REMOVED, {
        scheduleId: options.scheduleId,
        queue: this.name,
      });
    return ok;
  }

  async removeJobs(options: { jobIds: string[] } | { statuses: JobStatus[] }): Promise<number> {
    if ('jobIds' in options)
      return this.runtime.driver.removeJobsByIds({ jobIds: options.jobIds, queueName: this.name });
    return this.runtime.driver.removeJobsByStatus({
      queueName: this.name,
      statuses: options.statuses,
    });
  }

  async purgeJobs(options: { statuses: JobStatus[] }): Promise<number> {
    return this.runtime.driver.removeJobsByStatus({
      queueName: this.name,
      statuses: options.statuses,
    });
  }

  // --- Queue control (persisted, cluster-wide) ---
  async pause(options: { mode?: PauseMode } = {}): Promise<void> {
    const mode = options.mode ?? PauseMode.PROCESSING;
    await this.runtime.registry.ensure(this.name);
    await this.runtime.driver.setQueuePaused({
      queueName: this.name,
      processingPaused: true,
      acceptingPaused: mode === PauseMode.ALL,
      now: this.runtime.clock.now(),
    });
    await this.runtime.registry.refresh(this.name);
    this.runtime.events.emit(PortQueueEvent.QUEUE_PAUSED, { queue: this.name, mode });
  }

  async resume(): Promise<void> {
    await this.runtime.registry.ensure(this.name);
    await this.runtime.driver.setQueuePaused({
      queueName: this.name,
      processingPaused: false,
      acceptingPaused: false,
      now: this.runtime.clock.now(),
    });
    await this.runtime.registry.refresh(this.name);
    this.runtime.wakeup.signal(this.name);
    this.runtime.events.emit(PortQueueEvent.QUEUE_RESUMED, { queue: this.name });
  }

  /** Ensure the queue row exists (idempotent). Called during createQueue. */
  ensure(): Promise<unknown> {
    return this.runtime.registry.ensure(this.name);
  }

  private _jobNotFound(id: string): never {
    throw new JobNotFoundError(id);
  }
}
