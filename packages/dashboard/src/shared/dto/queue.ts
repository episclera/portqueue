/** Queue overview + aggregate stats wire DTOs. */
import type { CountsDto } from './job';

/**
 * One page of rows plus the total matching the query. Every list endpoint returns this shape,
 * so a table's "Results (n)" and its rows can never disagree and paging is uniform across pages.
 * A page that wants "is there more?" derives it from its own offset plus `items.length` against
 * `total` — the server never sends a second, redundant flag that could contradict the count.
 */
export interface PageDto<T> {
  items: T[];
  /** Rows matching the query across every page. */
  total: number;
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

/** An instance row with liveness, process health + per-instance job attribution (mirrors `InstanceInfo`). */
export interface InstanceDto {
  instanceKey: string;
  processingPaused: boolean;
  alive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  /**
   * The health of the **Node process** behind this instance, at its last heartbeat, both 0-100:
   * `cpuPercent` over the cores available to it, `memoryPercent` over V8's heap limit. Neither is
   * machine-wide. Null until the instance's first beat.
   */
  cpuPercent: number | null;
  memoryPercent: number | null;
  counts: CountsDto;
}

export type InstancePageDto = PageDto<InstanceDto>;
