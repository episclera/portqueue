/** Job-shaped wire DTOs. Dates are ISO strings so they survive JSON. */
import type { JobStatus } from '@portqueue/core';

/** JobStatus → count map, wire form. */
export type CountsDto = Record<string, number>;

/** A read-side job, serialized for the wire (mirrors core `JobSnapshot`). */
export interface JobDto {
  id: string;
  queue: string;
  status: JobStatus;
  data: unknown;
  returnValue?: unknown;
  priority: number;
  retryAttempt: number;
  retryMaxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startAfter: string;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  cancelledAt?: string | null;
  expiredAt?: string | null;
  retriedAt?: string | null;
  stalledAt?: string | null;
  lockedUntil?: string | null;
  preferredInstanceKeyPattern?: string | null;
  processedOnInstanceKey?: string | null;
  failureMessage?: string | null;
  idempotencyKey?: string | null;
  scheduleId?: string | null;
  stalled: boolean;
}

/** Page of jobs. `total` counts every match; a search counts them all, not just this window. */
export interface JobPageDto {
  items: JobDto[];
  /** Rows matching the query across every page. A search counts every match, not a window. */
  total: number;
}
