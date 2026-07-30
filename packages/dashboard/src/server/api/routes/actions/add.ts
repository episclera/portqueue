import { json } from '../../http';
import { requireQueue } from './validate';
import { ActionKind, type ActionRequestDto, type ActionResultDto } from '../../../../shared/dto';
import type { AddJobOptions } from '@portqueue/core';
import type { ActionRoute } from './types';

/**
 * `add` — the one action that legitimately produces onto a queue.
 *
 * It goes through the public producer path, so every validation core already enforces applies
 * unchanged. The queue is addressed by name: the dashboard's client is headless, so a name with no
 * queue row is refused rather than invented — which surfaces here as a 400 carrying core's message.
 */
export const addAction: ActionRoute = {
  kind: ActionKind.ADD,
  summary: 'Enqueue a job, or create a recurring schedule',
  handle: async ({ portQueue, action }) => {
    const queue = requireQueue(action);
    if (!queue.ok) return queue.response;
    if (!action.add || typeof action.add !== 'object') {
      return json(400, { error: 'Missing add payload' });
    }
    try {
      const result = await portQueue.addJob({
        queue: queue.value,
        ...buildAddOptions(action.add),
      });
      return json(200, {
        ok: true,
        ...(result.jobId ? { jobId: result.jobId } : {}),
        ...(result.scheduleId ? { scheduleId: result.scheduleId } : {}),
      } satisfies ActionResultDto);
    } catch (err) {
      // A bad cron, both cadences at once, a paused queue, an unknown queue — all actionable, and
      // none of them a server fault.
      return json(400, { error: err instanceof Error ? err.message : 'Cannot add job' });
    }
  },
};

/**
 * Translate the form's payload into core's `AddJobOptions`.
 *
 * Only keys the client actually set are forwarded, so an omitted field inherits the queue's default
 * rather than being pinned to a value the form invented. `cron` wins over `startEverySeconds` if both
 * somehow arrive: core rejects the pair, and picking one is friendlier than a 400 for a request the
 * UI cannot produce.
 */
function buildAddOptions(add: NonNullable<ActionRequestDto['add']>): AddJobOptions<unknown> {
  const opts: AddJobOptions<unknown> = { data: add.data };
  if (typeof add.priority === 'number') opts.priority = add.priority;
  if (add.idempotencyKey) opts.idempotencyKey = add.idempotencyKey;
  if (add.singletonKey) opts.singletonKey = add.singletonKey;
  if (typeof add.retryMaxAttempts === 'number') opts.retry = { maxAttempts: add.retryMaxAttempts };
  if (add.preferredInstanceKeyPattern) {
    opts.preferredInstanceKeyPattern = add.preferredInstanceKeyPattern;
  }
  const schedule: NonNullable<AddJobOptions<unknown>['schedule']> = {};
  if (add.startAfterSeconds != null) schedule.startAfterSeconds = add.startAfterSeconds;
  if (add.cron != null) schedule.cron = add.cron;
  else if (add.startEverySeconds != null) schedule.startEverySeconds = add.startEverySeconds;
  if (Object.keys(schedule).length > 0) opts.schedule = schedule;
  return opts;
}
