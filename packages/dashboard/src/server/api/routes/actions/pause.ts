import { PauseMode } from '@portqueue/core';
import { json } from '../../http';
import { requireQueue } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `pause` — stop workers everywhere from claiming this queue's jobs.
 *
 * `mode: ALL` also refuses new jobs. Anything other than `ALL` reads as `PROCESSING` rather than
 * being rejected: the stricter mode must always be asked for explicitly.
 */
export const pauseAction: ActionRoute = {
  kind: ActionKind.PAUSE,
  summary: 'Pause a queue (processing, or everything)',
  handle: async ({ portQueue, action }) => {
    const queue = requireQueue(action);
    if (!queue.ok) return queue.response;
    const mode = action.mode === PauseMode.ALL ? PauseMode.ALL : PauseMode.PROCESSING;
    await portQueue.pauseQueue({ queue: queue.value, mode });
    return json(200, { ok: true } satisfies ActionResultDto);
  },
};
