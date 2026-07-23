/** Queue overview + aggregate stats wire DTOs. */
import type { CountsDto } from './job';

/** Queue overview (mirrors core `QueueInfo`). */
export interface QueueDto {
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  counts: CountsDto;
  /** True when the dashboard's own process still declares this queue (createQueue/createWorker). */
  inUse: boolean;
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
