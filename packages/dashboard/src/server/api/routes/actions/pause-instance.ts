import { json } from '../../http';
import { requireInstanceKey } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `pauseInstance` — stop one named process from claiming jobs.
 *
 * Persisted on the instance row, so the target picks it up on its next heartbeat rather than needing
 * to be reachable from here.
 */
export const pauseInstanceAction: ActionRoute = {
  kind: ActionKind.PAUSE_INSTANCE,
  summary: 'Stop one instance from claiming jobs',
  handle: async ({ portQueue, action }) => {
    const instanceKey = requireInstanceKey(action);
    if (!instanceKey.ok) return instanceKey.response;
    await portQueue.pauseInstance({ instanceKey: instanceKey.value });
    return json(200, { ok: true } satisfies ActionResultDto);
  },
};
