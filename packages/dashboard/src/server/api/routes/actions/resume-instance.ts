import { json } from '../../http';
import { requireInstanceKey } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/** `resumeInstance` — let one named process claim jobs again. */
export const resumeInstanceAction: ActionRoute = {
  kind: ActionKind.RESUME_INSTANCE,
  summary: 'Let one instance claim jobs again',
  handle: async ({ portQueue, action }) => {
    const instanceKey = requireInstanceKey(action);
    if (!instanceKey.ok) return instanceKey.response;
    await portQueue.resumeInstance({ instanceKey: instanceKey.value });
    return json(200, { ok: true } satisfies ActionResultDto);
  },
};
