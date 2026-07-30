/**
 * The one path every job mutation takes.
 *
 * `retry`, `cancel` and `remove` differ only in the verb they hand to the facade, and the facade
 * turns each into a **single** statement over the whole id set — so a bulk selection costs the same
 * round trips as one row, and an id the action refuses (already gone, or an `ACTIVE` row) is simply
 * absent from `affected` rather than failing the rest.
 */
import { json, type HandlerResult } from '../../http';
import { requireJobIds, requireQueue } from './validate';
import type { ActionContext } from './types';
import type { JobBatchAction } from '@portqueue/core';
import type { ActionResultDto } from '../../../../shared/dto';

export async function runJobBatch(
  { portQueue, action }: ActionContext,
  verb: JobBatchAction,
): Promise<HandlerResult> {
  const queue = requireQueue(action);
  if (!queue.ok) return queue.response;
  const jobIds = requireJobIds(action);
  if (!jobIds.ok) return jobIds.response;

  const result = await portQueue._dashboard.runJobBatch({
    queue: queue.value,
    jobIds: jobIds.value,
    action: verb,
  });
  return json(200, {
    ok: result.affected > 0,
    affected: result.affected,
    requested: result.requested,
  } satisfies ActionResultDto);
}
