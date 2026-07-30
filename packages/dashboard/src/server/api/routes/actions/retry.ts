import { JobBatchAction } from '@portqueue/core';
import { runJobBatch } from './job-batch';
import { ActionKind } from '../../../../shared/dto';
import type { ActionRoute } from './types';

/**
 * `retry` — re-arm the selected jobs so they run again.
 *
 * A job that is still `ACTIVE` is left alone: clearing a running job's lock would let a second worker
 * claim it, so the same job would run twice at once. Those ids just don't count toward `affected`.
 */
export const retryAction: ActionRoute = {
  kind: ActionKind.RETRY,
  summary: 'Re-arm the selected jobs',
  handle: (ctx) => runJobBatch(ctx, JobBatchAction.RETRY),
};
