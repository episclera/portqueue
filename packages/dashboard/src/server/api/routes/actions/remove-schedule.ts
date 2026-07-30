import { json } from '../../http';
import { requireScheduleIds } from './validate';
import { ActionKind, type ActionResultDto } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `removeSchedule` — stop one or many recurrences from producing new jobs.
 *
 * The client never has to know which queue a schedule belongs to: the row carries it, and the facade
 * returns it, so the whole set goes in one statement and each removal still names its queue in the
 * event it emits. Jobs the schedule already produced are untouched.
 */
export const removeScheduleAction: ActionRoute = {
  kind: ActionKind.REMOVE_SCHEDULE,
  summary: 'Delete one or many schedules',
  handle: async ({ portQueue, action }) => {
    const ids = requireScheduleIds(action);
    if (!ids.ok) return ids.response;
    const result = await portQueue._dashboard.removeSchedules({ scheduleIds: ids.value });
    return json(200, {
      ok: result.affected > 0,
      affected: result.affected,
      requested: result.requested,
    } satisfies ActionResultDto);
  },
};
