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

/** An instance row with liveness + per-instance job attribution (mirrors core `InstanceInfo`). */
export interface InstanceDto {
  instanceKey: string;
  processingPaused: boolean;
  alive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  counts: CountsDto;
}
