/**
 * The one path every job mutation takes.
 *
 * `retry`, `cancel` and `remove` differ only in the verb they hand to the facade, and the facade
 * turns each into a **single** statement over the whole id set — so a bulk selection costs the same
 * round trips as one row, and an id the action refuses (already gone, or an `ACTIVE` row) is simply
 * absent from `affected` rather than failing the rest.
 *
 * There is deliberately no `queue` field. A job id identifies a row on its own and the statements
 * never narrowed by queue, so requiring one was validation theatre — and it forced the client to
 * split a selection spanning queues into one request per queue, which is exactly how a bulk action
 * came to be half-applied with a success toast and an error toast side by side.
 */
import { json, type HandlerResult } from '../../http';
import { requireJobIds } from './validate';
import type { ActionContext } from './types';
import type { JobBatchAction } from '@portqueue/core';
import type { ActionResultDto } from '../../../../shared/dto';

export async function runJobBatch(
  { portQueue, action }: ActionContext,
  verb: JobBatchAction,
): Promise<HandlerResult> {
  const jobIds = requireJobIds(action);
  if (!jobIds.ok) return jobIds.response;

  const result = await portQueue._dashboard.runJobBatch({
    jobIds: jobIds.value,
    action: verb,
  });
  const signalled = result.signalled ?? 0;
  return json(200, {
    ok: result.affected > 0 || signalled > 0,
    affected: result.affected,
    requested: result.requested,
    ...(signalled ? { signalled } : {}),
  } satisfies ActionResultDto);
}
