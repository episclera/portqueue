import type { JobRecord } from './job-record.js';
import type { JobSnapshot } from '../producer/results.js';
import { JobStatus } from './job-state.enum.js';

const d = (ms: number | null | undefined): Date | null => (ms == null ? null : new Date(ms));

/** Map an internal {@link JobRecord} to a public {@link JobSnapshot} (build_plan/05.2). */
export function toSnapshot<TData = unknown>(
  record: JobRecord,
  queueName: string,
  now: number,
): JobSnapshot<TData> {
  const stalled =
    record.status === JobStatus.ACTIVE && record.lockedUntil != null && record.lockedUntil < now;
  return {
    id: record.id,
    queue: queueName,
    status: record.status,
    data: record.data as TData,
    returnValue: record.returnValue,
    metadata: record.metadata,
    priority: record.priority,
    retryAttempt: record.retryAttempt,
    retryMaxAttempts: record.retryMaxAttempts,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    startAfter: new Date(record.startAfter),
    startedAt: d(record.startedAt),
    completedAt: d(record.completedAt),
    failedAt: d(record.failedAt),
    cancelledAt: d(record.cancelledAt),
    expiredAt: d(record.expiredAt),
    retriedAt: d(record.retriedAt),
    stalledAt: d(record.stalledAt),
    lockedUntil: d(record.lockedUntil),
    runOnInstanceId: record.runOnInstanceId,
    runOnInstanceType: record.runOnInstanceType,
    failureMessage: record.failureMessage,
    idempotencyKey: record.idempotencyKey,
    scheduleId: record.scheduleId,
    workflowId: record.workflowId,
    workflowStepKey: record.workflowStepKey,
    stalled,
  };
}
