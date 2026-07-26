/** Queue overview + aggregate stats wire DTOs. */
import type { CountsDto } from './job';

/**
 * One page of rows plus the total matching the query. Every list endpoint returns this shape,
 * so a table's "Results (n)" and its rows can never disagree and paging is uniform across pages.
 */
export interface PageDto<T> {
  items: T[];
  /** Rows matching the query across every page. */
  total: number;
  hasMore: boolean;
}

/** Queue overview (mirrors core `QueueInfo`). */
export interface QueueDto {
  name: string;
  processingPaused: boolean;
  acceptingPaused: boolean;
  counts: CountsDto;
  /** True when the host process still declares this queue (createQueue/createWorker). */
  inUse: boolean;
}

export type QueuePageDto = PageDto<QueueDto>;

/** Aggregated stats — per-status counts, which is all the activity cards render. */
export interface StatsDto {
  queue?: string;
  counts: CountsDto;
}

/** An instance row with liveness, health + per-instance job attribution (mirrors `InstanceInfo`). */
export interface InstanceDto {
  instanceKey: string;
  processingPaused: boolean;
  alive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  /**
   * The instance's health at its last heartbeat. Percentages are 0-100 (CPU is summed across
   * cores, so it can exceed 100); `rssBytes` is absolute. Null until the instance's first beat.
   */
  cpuPercent: number | null;
  memoryPercent: number | null;
  rssBytes: number | null;
  counts: CountsDto;
}

export type InstancePageDto = PageDto<InstanceDto>;
