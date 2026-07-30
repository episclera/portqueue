import { conflict, json } from '../../http';
import { requireQueue } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `removeQueue` — delete a queue's row.
 *
 * Core refuses while any process still declares the queue, which arrives here as a 409 carrying its
 * message. Job rows link by name with no foreign key, so they are untouched either way.
 */
export const removeQueueAction: ActionRoute = {
  kind: ActionKind.REMOVE_QUEUE,
  summary: 'Delete a queue row',
  handle: async ({ portQueue, action }) => {
    const queue = requireQueue(action);
    if (!queue.ok) return queue.response;
    try {
      const ok = await portQueue.removeQueue({ name: queue.value });
      return json(200, { ok } satisfies ActionResultDto);
    } catch (err) {
      return conflict(err, 'Cannot remove queue');
    }
  },
};
