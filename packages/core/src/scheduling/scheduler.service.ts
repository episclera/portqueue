import { JobStatus } from '../jobs/job-state.enum';
import { BackoffStrategy, RetentionMode } from '../options/enums';
import { PortQueueEvent } from '../events/event-name.enum';
import { CronExpression } from './cron';
import { secondsToMs } from '../util/seconds';
import {
  MAINTENANCE_BATCH_SIZE,
  MAINTENANCE_MAX_BATCHES,
  SCHEDULE_BATCH_SIZE,
  SCHEDULE_MAX_BATCHES,
} from '../constants';
import type { NewJobRecord, ScheduleRow } from '../jobs/job-record';
import type { Runtime } from '../client/runtime';

/**
 * Turns due schedules into concrete jobs. Production is exactly-once per
 * tick across the cluster (guarded `advanceSchedule`). A missed schedule fires once and
 * advances to the next future slot — it never backfills every missed occurrence.
 * The tick also owns expiring due-but-unstarted jobs and reclaiming stalled jobs.
 *
 * **Every sweep here is batched and looped.** Each pass takes a bounded number of rows and repeats
 * until a batch comes back short, so a backlog drains across round trips rather than either waiting
 * for the next tick (which one capped batch did to the 101st due schedule) or arriving as a single
 * unbounded transfer (which an uncapped `expireDueJobs` did to a 100k-row backlog).
 */
export class SchedulerService {
  constructor(private readonly runtime: Runtime) {}

  async tick(): Promise<void> {
    await this.produceDue();
    await this.expireDue();
    await this.reclaimStalled();
  }

  /**
   * Fire every schedule that is due, in batches. The loop matters: with more than one batch worth of
   * due schedules, the remainder used to wait a full tick interval — so a hundred hourly crons all
   * set for the same minute drifted apart from one another.
   */
  private async produceDue(): Promise<void> {
    for (let batch = 0; batch < SCHEDULE_MAX_BATCHES; batch += 1) {
      const now = this.runtime.clock.now();
      const due = await this.runtime.driver.getDueSchedules({ now, limit: SCHEDULE_BATCH_SIZE });
      for (const schedule of due) {
        try {
          await this.fire(schedule, now);
        } catch (err) {
          this.runtime.events.emit(PortQueueEvent.ERROR, { error: err, source: 'scheduler' });
        }
      }
      if (due.length < SCHEDULE_BATCH_SIZE) return;
    }
    this.runtime.logger.debug(
      `Scheduler stopped after ${SCHEDULE_MAX_BATCHES} batches; the rest fire on the next tick.`,
    );
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
      expireAt:
        t?.expireInSeconds != null ? now + secondsToMs(t.expireInSeconds, 'expireInSeconds') : null,
      retryAttempt: 0,
      retryMaxAttempts: schedule.retryMaxAttempts ?? 1,
      retryDelaySeconds: schedule.retryDelaySeconds ?? 0,
      retryBackoff: t?.retryBackoff ?? BackoffStrategy.FIXED,
      retryBackoffFactor: t?.retryBackoffFactor ?? null,
      retryMaxDelaySeconds: t?.retryMaxDelaySeconds ?? null,
      retryJitter: t?.retryJitter ?? false,
      retentionMode: t?.retentionMode ?? RetentionMode.KEEP_FOREVER,
      retentionTtlSeconds: t?.retentionTtlSeconds ?? null,
      retentionStatuses: t?.retentionStatuses ?? null,
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
    if (schedule.everySeconds != null) {
      return now + secondsToMs(schedule.everySeconds, 'schedule.startEverySeconds');
    }
    return null;
  }

  /**
   * Expire due-but-unstarted jobs past their deadline, in batches. The driver returns ids and queue
   * names rather than whole rows: those two are all that is used, and a backlog of a hundred
   * thousand expired jobs would otherwise transfer every column of every one of them.
   */
  private async expireDue(): Promise<void> {
    for (let batch = 0; batch < MAINTENANCE_MAX_BATCHES; batch += 1) {
      const expired = await this.runtime.driver.expireDueJobs({
        now: this.runtime.clock.now(),
        limit: MAINTENANCE_BATCH_SIZE,
      });
      for (const job of expired) {
        this.runtime.events.emit(PortQueueEvent.JOB_EXPIRED, {
          jobId: job.jobId,
          queue: job.queueName,
        });
      }
      if (expired.length < MAINTENANCE_BATCH_SIZE) return;
    }
    this.runtime.logger.debug(
      `Expiry stopped after ${MAINTENANCE_MAX_BATCHES} batches; the rest expire on the next tick.`,
    );
  }

  /** Return stalled jobs to PENDING, in batches, and wake the queues that gained work. */
  private async reclaimStalled(): Promise<void> {
    for (let batch = 0; batch < MAINTENANCE_MAX_BATCHES; batch += 1) {
      const reclaimed = await this.runtime.driver.reclaimStalledJobs({
        now: this.runtime.clock.now(),
        limit: MAINTENANCE_BATCH_SIZE,
      });
      const queues = new Set<string>();
      for (const job of reclaimed) {
        this.runtime.events.emit(PortQueueEvent.JOB_STALLED, {
          jobId: job.jobId,
          queue: job.queueName,
          previousInstanceKey: job.previousInstanceKey,
        });
        queues.add(job.queueName);
      }
      // One wakeup per queue rather than per row: a batch of stalled jobs on one queue only needs to
      // tell that queue's workers once.
      for (const queue of queues) this.runtime.wakeup.signal(queue);
      if (reclaimed.length < MAINTENANCE_BATCH_SIZE) return;
    }
    this.runtime.logger.debug(
      `Reclaim stopped after ${MAINTENANCE_MAX_BATCHES} batches; the rest reclaim on the next tick.`,
    );
  }
}
