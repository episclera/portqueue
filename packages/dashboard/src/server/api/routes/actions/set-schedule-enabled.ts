import { json } from '../../http';
import { requireScheduleId } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `setScheduleEnabled` — arm or disarm a schedule without deleting it.
 *
 * `enabled` must be sent explicitly. Treating a missing flag as a toggle would make the result depend
 * on state the client may not have refreshed, so two clicks could land as one no-op.
 */
export const setScheduleEnabledAction: ActionRoute = {
  kind: ActionKind.SET_SCHEDULE_ENABLED,
  summary: 'Arm or disarm a schedule',
  handle: async ({ portQueue, action }) => {
    const scheduleId = requireScheduleId(action);
    if (!scheduleId.ok) return scheduleId.response;
    if (typeof action.enabled !== 'boolean') return json(400, { error: 'Missing enabled' });
    const ok = await portQueue._dashboard.setScheduleEnabled({
      scheduleId: scheduleId.value,
      enabled: action.enabled,
    });
    return json(200, { ok } satisfies ActionResultDto);
  },
};
