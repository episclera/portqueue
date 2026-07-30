/**
 * `retry`, `cancel` and `remove` — the three job mutations, which are the same batch at three verbs.
 *
 * The point of these is that **one id and twenty take the same path**: both normalize to a list and
 * reach `pq._dashboard.runJobBatch` in a single call, which is what makes the whole selection one
 * statement rather than N. The previous implementation looped per id, where one stale id rolled back
 * every retry beside it.
 * @jest-environment node
 */
import { JobBatchAction } from '@portqueue/core';
import { fakePq, postAction } from '../../../../test-support/api';
import { ActionKind } from '../../../../shared/dto';

describe('POST /api/actions — job actions', () => {
  it('routes a single jobId through the same batch path as a bulk selection', async () => {
    const { pq, rec } = fakePq();
    const res = await postAction(pq, {
      kind: ActionKind.RETRY,
      queue: 'emails',
      jobId: 'job-1',
    });

    expect(res.status).toBe(200);
    expect(rec.batches).toEqual([
      { queue: 'emails', jobIds: ['job-1'], action: JobBatchAction.RETRY },
    ]);
  });

  it('sends every id of a bulk action in one call', async () => {
    const { pq, rec } = fakePq();
    const jobIds = ['a', 'b', 'c'];
    const res = await postAction(pq, { kind: ActionKind.REMOVE, queue: 'emails', jobIds });

    expect(res.body).toMatchObject({ ok: true, affected: 3, requested: 3 });
    // One call, not three — that is what makes the batch a single statement.
    expect(rec.batches).toHaveLength(1);
    expect(rec.batches[0]).toEqual({ queue: 'emails', jobIds, action: JobBatchAction.REMOVE });
  });

  it('reports a partial batch honestly rather than claiming every row landed', async () => {
    // Ids core refused — already gone, or an ACTIVE row a retry/remove won't touch — are simply not
    // counted, so the UI can say "1 of 3" instead of implying success.
    const { pq } = fakePq({ batchResult: { affected: 1, requested: 3 } });
    const res = await postAction(pq, {
      kind: ActionKind.CANCEL,
      queue: 'emails',
      jobIds: ['a', 'b', 'c'],
    });
    expect(res.body).toMatchObject({ ok: true, affected: 1, requested: 3 });
  });

  it('reports a batch that changed nothing as not ok', async () => {
    const { pq } = fakePq({ batchResult: { affected: 0, requested: 2 } });
    const res = await postAction(pq, {
      kind: ActionKind.RETRY,
      queue: 'emails',
      jobIds: ['a', 'b'],
    });
    expect(res.body).toMatchObject({ ok: false, affected: 0, requested: 2 });
  });

  it('maps each job action to its batch verb', async () => {
    for (const [kind, verb] of [
      [ActionKind.RETRY, JobBatchAction.RETRY],
      [ActionKind.CANCEL, JobBatchAction.CANCEL],
      [ActionKind.REMOVE, JobBatchAction.REMOVE],
    ] as const) {
      const { pq, rec } = fakePq();
      await postAction(pq, { kind, queue: 'emails', jobIds: ['x'] });
      expect(rec.batches[0]?.action).toBe(verb);
    }
  });

  it('rejects a job action with neither jobId nor jobIds', async () => {
    const { pq, rec } = fakePq();
    const res = await postAction(pq, { kind: ActionKind.RETRY, queue: 'emails' });
    expect(res.status).toBe(400);
    expect(rec.batches).toHaveLength(0);
  });

  it('rejects a job action with no queue', async () => {
    const { pq, rec } = fakePq();
    expect((await postAction(pq, { kind: ActionKind.RETRY, jobId: 'x' })).status).toBe(400);
    expect(rec.batches).toHaveLength(0);
  });
});
