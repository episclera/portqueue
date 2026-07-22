/** Queue overview + aggregate stats wire DTOs. */
import type { CountsDto } from './job.js';

/** Queue overview (mirrors core `QueueInfo`). */
export interface QueueDto {
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  counts: CountsDto;
}

/** Aggregated stats (mirrors core `QueueStats`). */
export interface StatsDto {
  queue?: string;
  counts: CountsDto;
  throughputPerMinute: number;
  failureRate: number;
}

/** Per-instance job attribution row for the Overview page. */
export interface InstanceBreakdownDto {
  instanceId: string;
  instanceType: string;
  count: number;
}
