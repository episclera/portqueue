/** Recurring schedule wire DTO (mirrors core `ScheduleInfo`), plus its queue. */
export interface ScheduleDto {
  scheduleId: string;
  queue: string;
  cron?: string | null;
  every?: number | null;
  timezone?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  enabled: boolean;
}
