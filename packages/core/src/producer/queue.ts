import { PauseMode } from '../options/enums';
import { PortQueueEvent } from '../events/event-name.enum';
import { JobNotFoundError } from '../errors/errors';
import type { AddJobOptions } from '../options/job-options';
import type {
  AddJobResult,
  GetJobsQuery,
  JobSnapshot,
  Page,
  QueueStats,
  ScheduleInfo,
} from './results';
import type { JobStatus } from '../jobs/job-state.enum';
import type { ProducerService } from './producer.service';
import type { ReadService } from '../monitoring/stats.service';
import type { Runtime } from '../client/runtime';
import type { TransactionHandle } from '../tx/transaction-handle';

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
  /**
   * Requeue a **failed or completed** job to run again — its own row is re-armed with its
   * persisted data (status back to `PENDING`, retry counters/lock/timestamps reset). For a
   * workflow, the failed step is its own job, so this resumes the run at that step. To start a
   * fresh run instead, add a new job to the queue with {@link addJob}.
   */
  async retryJob(options: { jobId: string }): Promise<AddJobResult> {
    const inserted = await this.runtime.driver.requeueJob({
      jobId: options.jobId,
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

  /**
   * Cancel a job. If the job is **currently running on this instance**, its handler's
   * `AbortSignal` is fired for cooperative cancellation (the handler must honour `job.signal`
   * to actually stop) and that settles the row. Otherwise a pending/delayed job is marked
   * `CANCELLED` so it never runs. Returns true if either path acted.
   */
  async cancelJob(options: { jobId: string }): Promise<boolean> {
    // A locally-running handler owns its row's outcome — fire its signal and let it settle,
    // rather than racing a DB write against its completion.
    if (this.runtime.cancelRunning?.(options.jobId)) return true;
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
