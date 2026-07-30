/**
 * `pause`, `resume` and `removeQueue` — the queue-scoped mutations.
 *
 * Each addresses its queue **by name** through the public API. A headless client declares nothing, so
 * there is no handle to build and pausing can never re-declare the queue (which is how it used to
 * wipe a queue's registered defaults).
 * @jest-environment node
 */
import { PauseMode } from '@portqueue/core';
import { fakePq, postAction } from '../../../../test-support/api';
import { ActionKind } from '../../../../shared/dto';

describe('POST /api/actions — queue actions', () => {
  it('pauses and resumes through the public API', async () => {
    const { pq, rec } = fakePq();
    expect((await postAction(pq, { kind: ActionKind.PAUSE, queue: 'emails' })).status).toBe(200);
    expect((await postAction(pq, { kind: ActionKind.RESUME, queue: 'emails' })).status).toBe(200);
    expect(rec.calls).toEqual(['pauseQueue', 'resumeQueue']);
  });

  it('defaults to pausing processing only, so ALL must be asked for', async () => {
    // PauseMode.ALL also refuses new jobs, which is the destructive half — never a default.
    const { pq } = fakePq();
    expect(
      (await postAction(pq, { kind: ActionKind.PAUSE, queue: 'emails', mode: 'nonsense' })).status,
    ).toBe(200);
    expect(
      (await postAction(pq, { kind: ActionKind.PAUSE, queue: 'emails', mode: PauseMode.ALL }))
        .status,
    ).toBe(200);
  });

  it('rejects each queue action with no queue', async () => {
    const { pq, rec } = fakePq();
    for (const kind of [ActionKind.PAUSE, ActionKind.RESUME, ActionKind.REMOVE_QUEUE]) {
      expect((await postAction(pq, { kind })).status).toBe(400);
    }
    expect(rec.calls).toHaveLength(0);
  });

  it('turns a QueueInUseError into a 409 carrying core’s message', async () => {
    // The queue is still declared by a running process — the caller's problem to resolve, not a
    // server fault, so it must not read as a 500.
    const { pq } = fakePq({
      throwOn: { method: 'removeQueue', error: new Error("Queue 'emails' is still in use") },
    });
    const res = await postAction(pq, { kind: ActionKind.REMOVE_QUEUE, queue: 'emails' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('still in use');
  });
});
