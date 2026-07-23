import { JobStatus } from '../jobs/job-state.enum';
import { PortQueueEvent } from '../events/event-name.enum';
import { CronExpression } from './cron';
import type { NewJobRecord, ScheduleRow } from '../jobs/job-record';
import type { Runtime } from '../client/runtime';

/**
 * Turns due schedules into concrete jobs. Production is exactly-once per
 * tick across the cluster (guarded `advanceSchedule`). A missed schedule fires once and
 * advances to the next future slot — it never backfills every missed occurrence.
 * The tick also owns expiring due-but-unstarted jobs and reclaiming stalled jobs.
 */
export class SchedulerService {
  constructor(private readonly runtime: Runtime) {}

  async tick(): Promise<void> {
    await this.produceDue();
    await this.expireDue();
    await this.reclaimStalled();
  }

  private async produceDue(): Promise<void> {
    const now = this.runtime.clock.now();
    const due = await this.runtime.driver.getDueSchedules({ now, limit: 100 });
    for (const schedule of due) {
      try {
        await this.fire(schedule, now);
      } catch (err) {
        this.runtime.events.emit(PortQueueEvent.ERROR, { error: err, source: 'scheduler' });
      }
    }
  }

  private async fire(schedule: ScheduleRow, now: number): Promise<void> {
    const previous = schedule.nextRunAt;
    if (previous == null) return;

    // Compute the next future slot (fire-once semantics; no backfill).
    let nextRunAt: number | null = this.computeNext(schedule, now);
    if (schedule.endAt != null && (nextRunAt == null || nextRunAt > schedule.endAt)) {
      nextRunAt = null; // schedule has ended
    }

    // Claim this tick — only one instance wins the guarded advance.
    const won = await this.runtime.driver.advanceSchedule({
      scheduleId: schedule.id,
      nextRunAt,
      lastRunAt: now,
      fromNextRunAt: previous,
    });
    if (!won) return;

    const resolved = this.runtime.resolver.resolve({ job: {}, now });
    const queueName = schedule.queueName;
    const job: NewJobRecord = {
      queueName: schedule.queueName,
      status: JobStatus.PENDING,
      priority: schedule.priority ?? resolved.priority,
      data: schedule.data,
      metadata: {},
      startAfter: now,
      expireAt: null,
      retryAttempt: 0,
      retryMaxAttempts: schedule.retryMaxAttempts ?? resolved.retryMaxAttempts,
      retryDelayMs: schedule.retryDelayMs ?? resolved.retryDelayMs,
      retryBackoff: resolved.retryBackoff,
      retryBackoffFactor: resolved.retryBackoffFactor,
      retryMaxDelayMs: resolved.retryMaxDelayMs,
      retryJitter: resolved.retryJitter,
      retentionMode: resolved.retentionMode,
      retentionTtlMs: resolved.retentionTtlMs,
      idempotencyKey: null,
      scheduleId: schedule.id,
      singletonKey: null,
      workflowId: null,
      workflowStepKey: null,
      preferredInstanceKeyPattern: null,
      createdAt: now,
    };
    const inserted = await this.runtime.driver.insertJob({ job });
    this.runtime.events.emit(PortQueueEvent.SCHEDULE_FIRED, {
      scheduleId: schedule.id,
      jobId: inserted.id,
      queue: queueName,
    });
    this.runtime.wakeup.signal(queueName);
  }

  private computeNext(schedule: ScheduleRow, now: number): number | null {
    if (schedule.cron) {
      return new CronExpression(schedule.cron, schedule.timezone ?? 'UTC').next(now);
    }
    if (schedule.everyMs != null) return now + schedule.everyMs;
    return null;
  }

  private async expireDue(): Promise<void> {
    const now = this.runtime.clock.now();
    const expired = await this.runtime.driver.expireDueJobs({ now });
    for (const job of expired) {
      this.runtime.events.emit(PortQueueEvent.JOB_EXPIRED, { jobId: job.id, queue: job.queueName });
    }
  }

  private async reclaimStalled(): Promise<void> {
    const now = this.runtime.clock.now();
    const reclaimed = await this.runtime.driver.reclaimStalledJobs({ now });
    for (const job of reclaimed) {
      this.runtime.events.emit(PortQueueEvent.JOB_STALLED, {
        jobId: job.id,
        queue: job.queueName,
        previousInstanceId: job.lockedByInstanceId,
      });
      this.runtime.wakeup.signal(job.queueName);
    }
  }
}
