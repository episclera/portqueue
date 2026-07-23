/**
 * Maps PortQueue snapshots → wire DTOs. Pure functions, fully typed;
 * the single place Dates become ISO strings for the JSON boundary.
 */
import type {
  JobSnapshot,
  InstanceInfo,
  QueueInfo,
  QueueStats,
  ScheduleInfo,
  WorkflowSnapshot,
  Page,
} from '@portqueue/core';
import type {
  JobDto,
  JobPageDto,
  QueueDto,
  ScheduleDto,
  StatsDto,
  WorkflowDto,
  InstanceDto,
  CountsDto,
} from '../../shared/dto.js';

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
    metadata: job.metadata,
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
    workflowId: job.workflowId,
    workflowStepKey: job.workflowStepKey,
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

export function serializeStats(s: QueueStats): StatsDto {
  return {
    ...(s.queue !== undefined ? { queue: s.queue } : {}),
    counts: counts(s.counts),
    throughputPerMinute: s.throughputPerMinute,
    failureRate: s.failureRate,
  };
}

export function serializeJobPage(page: Page<JobSnapshot>): JobPageDto {
  return {
    items: page.items.map(serializeJob),
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
}

export function serializeWorkflow(w: WorkflowSnapshot): WorkflowDto {
  return {
    workflowId: w.workflowId,
    queue: w.queue,
    steps: w.steps.map(serializeJob),
  };
}

export function serializeSchedule(s: ScheduleInfo, queue: string): ScheduleDto {
  return {
    scheduleId: s.scheduleId,
    queue,
    cron: s.cron,
    every: s.every,
    timezone: s.timezone,
    nextRunAt: iso(s.nextRunAt),
    lastRunAt: iso(s.lastRunAt),
    enabled: s.enabled,
  };
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
