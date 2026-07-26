/** Recurring schedule wire DTO (mirrors core `ScheduleInfo`), plus its queue. */
import type { PageDto } from './queue';

export interface ScheduleDto {
  scheduleId: string;
  queue: string;
  cron?: string | null;
  /** For an interval schedule: the seconds between runs. */
  everySeconds?: number | null;
  timezone?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  enabled: boolean;
  /** The dedup token this schedule was created with, if any. */
  idempotencyKey?: string | null;
}

export type SchedulePageDto = PageDto<ScheduleDto>;
