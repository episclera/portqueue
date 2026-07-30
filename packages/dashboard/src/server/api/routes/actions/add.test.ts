/**
 * `add` — the one action that produces onto a queue.
 *
 * It goes through the public producer path, so these cover the translation from the form's payload to
 * core's `AddJobOptions`: only keys the client actually set are forwarded (an omitted field must
 * inherit the queue's default rather than being pinned to something the form invented), and anything
 * core rejects comes back as a 400 with core's own message.
 * @jest-environment node
 */
import { fakePq, postAction } from '../../../../test-support/api';
import { ActionKind } from '../../../../shared/dto';

describe('POST /api/actions — add', () => {
  it('forwards every option the form can set', async () => {
    const { pq, rec } = fakePq();
    await postAction(pq, {
      kind: ActionKind.ADD,
      queue: 'emails',
      add: {
        data: { to: 'a@b.com' },
        priority: 5,
        idempotencyKey: 'k1',
        singletonKey: 's1',
        retryMaxAttempts: 7,
        preferredInstanceKeyPattern: '^eu-',
        startAfterSeconds: 30,
      },
    });
    expect(rec.adds[0]).toMatchObject({
      queue: 'emails',
      data: { to: 'a@b.com' },
      priority: 5,
      idempotencyKey: 'k1',
      singletonKey: 's1',
      retry: { maxAttempts: 7 },
      preferredInstanceKeyPattern: '^eu-',
      schedule: { startAfterSeconds: 30 },
    });
  });

  it('forwards nothing the client left out', async () => {
    const { pq, rec } = fakePq();
    await postAction(pq, { kind: ActionKind.ADD, queue: 'emails', add: { data: {} } });
    expect(Object.keys(rec.adds[0] as object).sort()).toEqual(['data', 'queue']);
  });

  it('builds a cron schedule, and prefers cron when both cadences somehow arrive', async () => {
    const { pq, rec } = fakePq({ addResult: { scheduleId: 'sch-9' } });
    const res = await postAction(pq, {
      kind: ActionKind.ADD,
      queue: 'reports',
      add: { data: {}, cron: '0 0 * * *', startEverySeconds: 60 },
    });
    expect(res.body.scheduleId).toBe('sch-9');
    expect(rec.adds[0]).toMatchObject({ schedule: { cron: '0 0 * * *' } });
    expect(
      (rec.adds[0] as { schedule: Record<string, unknown> }).schedule.startEverySeconds,
    ).toBeUndefined();
  });

  it('builds an interval schedule when only startEverySeconds is given', async () => {
    const { pq, rec } = fakePq({ addResult: { scheduleId: 'sch-8' } });
    await postAction(pq, {
      kind: ActionKind.ADD,
      queue: 'reports',
      add: { data: {}, startEverySeconds: 60 },
    });
    expect(rec.adds[0]).toMatchObject({ schedule: { startEverySeconds: 60 } });
  });

  it('reports a rejected add as a 400 with core’s message, not a 500', async () => {
    // A bad cron, both cadences at once, a paused queue, a queue with no row: all actionable, none a
    // server fault.
    const { pq } = fakePq({
      throwOn: { method: 'addJob', error: new Error('Invalid cron expression') },
    });
    const res = await postAction(pq, {
      kind: ActionKind.ADD,
      queue: 'emails',
      add: { data: {} },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid cron expression');
  });

  it('rejects an add with no payload, and one with no queue', async () => {
    const { pq, rec } = fakePq();
    expect((await postAction(pq, { kind: ActionKind.ADD, queue: 'emails' })).status).toBe(400);
    expect((await postAction(pq, { kind: ActionKind.ADD, add: { data: {} } })).status).toBe(400);
    expect(rec.adds).toHaveLength(0);
  });
});
