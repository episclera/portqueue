import { JobBatchAction } from '@portqueue/core';
import { runJobBatch } from './job-batch';
import { ActionKind } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `remove` — delete the selected job rows.
 *
 * An `ACTIVE` row belongs to a live handler and is never deleted; cancel it first, then remove it
 * once it has settled.
 */
export const removeAction: ActionRoute = {
  kind: ActionKind.REMOVE,
  summary: 'Delete the selected job rows',
  handle: (ctx) => runJobBatch(ctx, JobBatchAction.REMOVE),
};
