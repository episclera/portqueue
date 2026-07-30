import { JobBatchAction } from '@portqueue/core';
import { runJobBatch } from './job-batch';
import { ActionKind } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `cancel` — stop the selected jobs from running, without deleting their rows.
 *
 * A job running in the client's own process is cancelled by firing its handler's `AbortSignal`; the
 * rest are marked `CANCELLED` so they never start.
 */
export const cancelAction: ActionRoute = {
  kind: ActionKind.CANCEL,
  summary: 'Cancel the selected jobs',
  handle: (ctx) => runJobBatch(ctx, JobBatchAction.CANCEL),
};
