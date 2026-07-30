import { json } from '../../http';
import { requireQueue } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/** `resume` — let workers claim this queue again, and accept new jobs. */
export const resumeAction: ActionRoute = {
  kind: ActionKind.RESUME,
  summary: 'Resume a paused queue',
  handle: async ({ portQueue, action }) => {
    const queue = requireQueue(action);
    if (!queue.ok) return queue.response;
    await portQueue.resumeQueue({ queue: queue.value });
    return json(200, { ok: true } satisfies ActionResultDto);
  },
};
