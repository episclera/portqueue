/**
 * Maps PortQueue snapshots → wire DTOs. Pure functions, fully typed;
 * the single place Dates become ISO strings for the JSON boundary.
 */
import type { JobSnapshot, InstanceInfo, QueueInfo, QueueStats, Page } from '@portqueue/core';
import type {
  JobDto,
  JobPageDto,
  QueueDto,
  QueuePageDto,
  ScheduleDto,
  SchedulePageDto,
  StatsDto,
  InstanceDto,
  InstancePageDto,
  CountsDto,
} from '../../shared/dto';

/** A schedule as core's dashboard facade returns it: `ScheduleInfo` plus its queue. */
export interface ScheduleWithQueue {
  scheduleId: string;
  queue: string;
  cron?: string | null;
  every?: number | null;
  timezone?: string | null;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  enabled: boolean;
  idempotencyKey?: string | null;
}

function iso(d: Date | null | undefined): string | null | undefined {
  if (d === null) return null;
  if (d === undefined) return undefined;
  return d.toISOString();
}

function counts(c: QueueInfo['counts']): CountsDto {
  return { ...c } as CountsDto;
}

export function serializeJob(job: JobSnapshot): JobDto {
  return {
    id: job.id,
    queue: job.queue,
    status: job.status,
    data: job.data,
    returnValue: job.returnValue,
    priority: job.priority,
    retryAttempt: job.retryAttempt,
    retryMaxAttempts: job.retryMaxAttempts,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startAfter: job.startAfter.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    failedAt: iso(job.failedAt),
    cancelledAt: iso(job.cancelledAt),
    expiredAt: iso(job.expiredAt),
    retriedAt: iso(job.retriedAt),
    stalledAt: iso(job.stalledAt),
    lockedUntil: iso(job.lockedUntil),
    preferredInstanceKeyPattern: job.preferredInstanceKeyPattern,
    processedOnInstanceKey: job.processedOnInstanceKey,
    failureMessage: job.failureMessage,
    idempotencyKey: job.idempotencyKey,
    scheduleId: job.scheduleId,
    stalled: job.stalled,
  };
}

export function serializeQueue(q: QueueInfo): QueueDto {
  return {
    name: q.name,
    processingPaused: q.processingPaused,
    acceptingPaused: q.acceptingPaused,
    counts: counts(q.counts),
    inUse: q.inUse,
  };
}

export function serializeQueuePage(page: Page<QueueInfo>): QueuePageDto {
  return { items: page.items.map(serializeQueue), total: page.total, hasMore: page.hasMore };
}

export function serializeStats(s: QueueStats): StatsDto {
  return {
    ...(s.queue !== undefined ? { queue: s.queue } : {}),
    counts: counts(s.counts),
  };
}

export function serializeJobPage(
  page: Page<JobSnapshot> & { searchTruncated?: boolean },
): JobPageDto {
  return {
    items: page.items.map(serializeJob),
    cursor: page.cursor,
    hasMore: page.hasMore,
    total: page.total,
    ...(page.searchTruncated ? { searchTruncated: true } : {}),
  };
}

export function serializeSchedule(s: ScheduleWithQueue): ScheduleDto {
  return {
    scheduleId: s.scheduleId,
    queue: s.queue,
    cron: s.cron,
    every: s.every,
    timezone: s.timezone,
    nextRunAt: iso(s.nextRunAt),
    lastRunAt: iso(s.lastRunAt),
    enabled: s.enabled,
    idempotencyKey: s.idempotencyKey,
  };
}

export function serializeSchedulePage(page: Page<ScheduleWithQueue>): SchedulePageDto {
  return { items: page.items.map(serializeSchedule), total: page.total, hasMore: page.hasMore };
}

/** Serialize an instance overview row. */
export function serializeInstance(i: InstanceInfo): InstanceDto {
  return {
    instanceKey: i.instanceKey,
    processingPaused: i.processingPaused,
    alive: i.alive,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    lastSeenAt: i.lastSeenAt.toISOString(),
    counts: counts(i.counts),
  };
}

export function serializeInstancePage(page: Page<InstanceInfo>): InstancePageDto {
  return { items: page.items.map(serializeInstance), total: page.total, hasMore: page.hasMore };
}
