import { conflict, json } from '../../http';
import { requireInstanceKey } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `removeInstance` — tidy a long-inactive process out of the instances list.
 *
 * Core refuses while the instance is still heartbeating (a live one would simply re-register on its
 * next beat), which arrives here as a 409. Job rows record the instance key as a plain string, so
 * removal never touches them.
 */
export const removeInstanceAction: ActionRoute = {
  kind: ActionKind.REMOVE_INSTANCE,
  summary: 'Remove a long-inactive instance row',
  handle: async ({ portQueue, action }) => {
    const instanceKey = requireInstanceKey(action);
    if (!instanceKey.ok) return instanceKey.response;
    try {
      const ok = await portQueue.removeInstance({ instanceKey: instanceKey.value });
      return json(200, { ok } satisfies ActionResultDto);
    } catch (err) {
      return conflict(err, 'Cannot remove instance');
    }
  },
};
