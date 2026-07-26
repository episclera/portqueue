import { JobStatus } from '../jobs/job-state.enum';
import { BackoffStrategy, RetentionMode } from '../options/enums';
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

    // Stamp every option the recurring add carried (see ScheduledJobOptions) onto this run. These
    // shape the produced job, never the schedule itself; `expireInSeconds` becomes an absolute
    // deadline relative to *this* run. Produced jobs are never given the schedule's idempotencyKey,
    // so the recurrence keeps firing.
    const t = schedule.jobOptions;
    const queueName = schedule.queueName;
    const job: NewJobRecord = {
      queueName: schedule.queueName,
      status: JobStatus.PENDING,
      priority: schedule.priority ?? 0,
      data: schedule.data,
      startAfter: now,
      expireAt: t?.expireInSeconds != null ? now + t.expireInSeconds * 1000 : null,
      retryAttempt: 0,
      retryMaxAttempts: schedule.retryMaxAttempts ?? 1,
      retryDelaySeconds: schedule.retryDelaySeconds ?? 0,
      retryBackoff: t?.retryBackoff ?? BackoffStrategy.FIXED,
      retryBackoffFactor: t?.retryBackoffFactor ?? null,
      retryMaxDelaySeconds: t?.retryMaxDelaySeconds ?? null,
      retryJitter: t?.retryJitter ?? false,
      retentionMode: t?.retentionMode ?? RetentionMode.KEEP_FOREVER,
      retentionTtlSeconds: t?.retentionTtlSeconds ?? null,
      idempotencyKey: null,
      scheduleId: schedule.id,
      singletonKey: t?.singletonKey ?? null,
      preferredInstanceKeyPattern: t?.preferredInstanceKeyPattern ?? null,
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
    if (schedule.everySeconds != null) return now + schedule.everySeconds * 1000;
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
        previousInstanceKey: job.processedOnInstanceKey,
      });
      this.runtime.wakeup.signal(job.queueName);
    }
  }
}
