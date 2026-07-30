/**
 * `pauseInstance`, `resumeInstance` and `removeInstance` — the queue-less mutations.
 *
 * They address a process by its instance key, and the pause is persisted on the row rather than pushed
 * at the target, so it works whether or not the dashboard can reach that process.
 * @jest-environment node
 */
import { fakePq, postAction } from '../../../../test-support/api';
import { ActionKind } from '../../../../shared/dto';

describe('POST /api/actions — instance actions', () => {
  it('pauses, resumes and removes by instance key', async () => {
    const { pq, rec } = fakePq();
    for (const kind of [
      ActionKind.PAUSE_INSTANCE,
      ActionKind.RESUME_INSTANCE,
      ActionKind.REMOVE_INSTANCE,
    ]) {
      expect((await postAction(pq, { kind, instanceKey: 'worker-1' })).status).toBe(200);
    }
    expect(rec.calls).toEqual(['pauseInstance', 'resumeInstance', 'removeInstance']);
  });

  it('rejects each instance action with no key', async () => {
    const { pq, rec } = fakePq();
    for (const kind of [
      ActionKind.PAUSE_INSTANCE,
      ActionKind.RESUME_INSTANCE,
      ActionKind.REMOVE_INSTANCE,
    ]) {
      expect((await postAction(pq, { kind })).status).toBe(400);
    }
    expect(rec.calls).toHaveLength(0);
  });

  it('turns an InstanceActiveError into a 409', async () => {
    // A live instance would just re-register on its next beat, so core refuses — and says why.
    const { pq } = fakePq({
      throwOn: { method: 'removeInstance', error: new Error('Instance is still active') },
    });
    const res = await postAction(pq, {
      kind: ActionKind.REMOVE_INSTANCE,
      instanceKey: 'worker-1',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('still active');
  });
});
