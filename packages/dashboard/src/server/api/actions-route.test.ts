/**
 * The actions endpoint: how each mutation reaches core, and how core's refusals reach the client.
 *
 * The batch cases are the point. Every job-scoped mutation — a single id or twenty — goes through
 * `pq._dashboard.runJobBatch` so it lands in one transaction, and every schedule removal through
 * `removeSchedules`. Nothing here calls `createQueue`, which would register the queue in the host
 * process and permanently flip its `inUse` flag.
 * @jest-environment node
 */
import { JobBatchAction, type PortQueue } from '@portqueue/core';
import { createRouter } from './routes';
import { ActionKind, type ActionRequestDto, type ActionResultDto } from '../../shared/dto';

interface Recorded {
  batches: { queue: string; jobIds: string[]; action: JobBatchAction }[];
  scheduleRemovals: string[][];
  scheduleToggles: { scheduleId: string; enabled: boolean }[];
  adds: unknown[];
  queueCalls: string[];
  calls: string[];
}

/** A PortQueue that records what the router asked of it, with overridable outcomes. */
function fakePq(
  over: {
    batchResult?: { affected: number; requested: number };
    scheduleEnabled?: boolean;
    schedulesRemoved?: { affected: number; requested: number };
    throwOn?: { method: string; error: Error };
    addResult?: { jobId?: string; scheduleId?: string };
  } = {},
): { pq: PortQueue; rec: Recorded } {
  const rec: Recorded = {
    batches: [],
    scheduleRemovals: [],
    scheduleToggles: [],
    adds: [],
    queueCalls: [],
    calls: [],
  };

  /** Throw for the named method when the test asked it to, else return `value`. */
  const maybeThrow = <T>(method: string, value: T): T => {
    rec.calls.push(method);
    if (over.throwOn?.method === method) throw over.throwOn.error;
    return value;
  };

  const pq = {
    _dashboard: {
      runJobBatch: async (opts: { queue: string; jobIds: string[]; action: JobBatchAction }) => {
        rec.batches.push(opts);
        return over.batchResult ?? { affected: opts.jobIds.length, requested: opts.jobIds.length };
      },
      removeSchedules: async (opts: { scheduleIds: string[] }) => {
        rec.scheduleRemovals.push(opts.scheduleIds);
        return (
          over.schedulesRemoved ?? {
            affected: opts.scheduleIds.length,
            requested: opts.scheduleIds.length,
          }
        );
      },
      setScheduleEnabled: async (opts: { scheduleId: string; enabled: boolean }) => {
        rec.scheduleToggles.push(opts);
        return over.scheduleEnabled ?? true;
      },
    },
    createQueue: (name: string) => {
      rec.queueCalls.push(name);
      return {
        addJob: async (opts: unknown) => {
          rec.adds.push(opts);
          if (over.throwOn?.method === 'addJob') throw over.throwOn.error;
          return over.addResult ?? { jobId: 'job-new', queue: name, deduplicated: false };
        },
      };
    },
    pauseQueue: async () => maybeThrow('pauseQueue', undefined),
    resumeQueue: async () => maybeThrow('resumeQueue', undefined),
    removeQueue: async () => maybeThrow('removeQueue', true),
    pauseInstance: async () => maybeThrow('pauseInstance', undefined),
    resumeInstance: async () => maybeThrow('resumeInstance', undefined),
    removeInstance: async () => maybeThrow('removeInstance', true),
  } as unknown as PortQueue;

  return { pq, rec };
}

async function post(
  pq: PortQueue,
  action: ActionRequestDto | Record<string, unknown>,
): Promise<{ status: number; body: ActionResultDto & { error?: string } }> {
  const router = createRouter({ portQueue: pq, basePath: '/portqueue' });
  const res = await router.handle({
    method: 'POST',
    url: '/portqueue/api/actions',
    body: JSON.stringify(action),
    headers: {},
  });
  return { status: res.status, body: JSON.parse(res.body) as ActionResultDto };
}

describe('POST /api/actions — job actions', () => {
  it('routes a single retry through the transactional batch path', async () => {
    const { pq, rec } = fakePq();
    const res = await post(pq, { kind: ActionKind.RETRY, queue: 'emails', jobId: 'job-1' });

    expect(res.status).toBe(200);
    expect(rec.batches).toEqual([
      { queue: 'emails', jobIds: ['job-1'], action: JobBatchAction.RETRY },
    ]);
  });

  it('sends every id of a bulk action in one call', async () => {
    const { pq, rec } = fakePq();
    const jobIds = ['a', 'b', 'c'];
    const res = await post(pq, { kind: ActionKind.REMOVE, queue: 'emails', jobIds });

    expect(res.body).toMatchObject({ ok: true, affected: 3, requested: 3 });
    // One call, not three — that is what makes the batch a single transaction.
    expect(rec.batches).toHaveLength(1);
    expect(rec.batches[0]).toEqual({ queue: 'emails', jobIds, action: JobBatchAction.REMOVE });
  });

  it('reports a partial batch honestly rather than claiming every row landed', async () => {
    const { pq } = fakePq({ batchResult: { affected: 1, requested: 3 } });
    const res = await post(pq, {
      kind: ActionKind.CANCEL,
      queue: 'emails',
      jobIds: ['a', 'b', 'c'],
    });
    expect(res.body).toMatchObject({ affected: 1, requested: 3 });
  });

  it('maps each job action to its batch verb', async () => {
    for (const [kind, verb] of [
      [ActionKind.RETRY, JobBatchAction.RETRY],
      [ActionKind.CANCEL, JobBatchAction.CANCEL],
      [ActionKind.REMOVE, JobBatchAction.REMOVE],
    ] as const) {
      const { pq, rec } = fakePq();
      await post(pq, { kind, queue: 'emails', jobIds: ['x'] });
      expect(rec.batches[0]?.action).toBe(verb);
    }
  });

  it('rejects a job action with neither jobId nor jobIds', async () => {
    const { pq, rec } = fakePq();
    const res = await post(pq, { kind: ActionKind.RETRY, queue: 'emails' });
    expect(res.status).toBe(400);
    expect(rec.batches).toHaveLength(0);
  });

  it('rejects a queue-scoped action with no queue', async () => {
    const { pq } = fakePq();
    expect((await post(pq, { kind: ActionKind.RETRY, jobId: 'x' })).status).toBe(400);
  });
});

describe('POST /api/actions — queue actions', () => {
  it('pauses and resumes through the public API', async () => {
    const { pq, rec } = fakePq();
    expect((await post(pq, { kind: ActionKind.PAUSE, queue: 'emails' })).status).toBe(200);
    expect((await post(pq, { kind: ActionKind.RESUME, queue: 'emails' })).status).toBe(200);
    expect(rec.calls).toEqual(['pauseQueue', 'resumeQueue']);
  });

  it('turns a QueueInUseError into a 409 carrying core’s message', async () => {
    const { pq } = fakePq({
      throwOn: { method: 'removeQueue', error: new Error("Queue 'emails' is still in use") },
    });
    const res = await post(pq, { kind: ActionKind.REMOVE_QUEUE, queue: 'emails' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('still in use');
  });
});

describe('POST /api/actions — instance actions', () => {
  it('pauses, resumes and removes by instance key', async () => {
    const { pq, rec } = fakePq();
    for (const kind of [
      ActionKind.PAUSE_INSTANCE,
      ActionKind.RESUME_INSTANCE,
      ActionKind.REMOVE_INSTANCE,
    ]) {
      expect((await post(pq, { kind, instanceKey: 'worker-1' })).status).toBe(200);
    }
    expect(rec.calls).toEqual(['pauseInstance', 'resumeInstance', 'removeInstance']);
  });

  it('rejects an instance action with no key', async () => {
    const { pq } = fakePq();
    expect((await post(pq, { kind: ActionKind.PAUSE_INSTANCE })).status).toBe(400);
  });

  it('turns an InstanceActiveError into a 409', async () => {
    const { pq } = fakePq({
      throwOn: { method: 'removeInstance', error: new Error('Instance is still active') },
    });
    const res = await post(pq, { kind: ActionKind.REMOVE_INSTANCE, instanceKey: 'worker-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('still active');
  });
});

describe('POST /api/actions — schedule actions', () => {
  it('removes one schedule without being told its queue', async () => {
    // The facade resolves the queue from the id, so the client never has to know it.
    const { pq, rec } = fakePq();
    const res = await post(pq, { kind: ActionKind.REMOVE_SCHEDULE, scheduleId: 'sch-1' });
    expect(res.status).toBe(200);
    expect(rec.scheduleRemovals).toEqual([['sch-1']]);
  });

  it('removes many schedules in one call', async () => {
    const { pq, rec } = fakePq();
    const res = await post(pq, {
      kind: ActionKind.REMOVE_SCHEDULE,
      scheduleIds: ['sch-1', 'sch-2'],
    });
    expect(res.body).toMatchObject({ affected: 2, requested: 2 });
    expect(rec.scheduleRemovals).toEqual([['sch-1', 'sch-2']]);
  });

  it('rejects a schedule removal naming nothing', async () => {
    const { pq } = fakePq();
    expect((await post(pq, { kind: ActionKind.REMOVE_SCHEDULE })).status).toBe(400);
  });

  it('enables and disables a schedule', async () => {
    const { pq, rec } = fakePq();
    await post(pq, {
      kind: ActionKind.SET_SCHEDULE_ENABLED,
      scheduleId: 'sch-1',
      enabled: false,
    });
    await post(pq, { kind: ActionKind.SET_SCHEDULE_ENABLED, scheduleId: 'sch-1', enabled: true });
    expect(rec.scheduleToggles).toEqual([
      { scheduleId: 'sch-1', enabled: false },
      { scheduleId: 'sch-1', enabled: true },
    ]);
  });

  it('requires an explicit enabled flag rather than guessing', async () => {
    const { pq } = fakePq();
    const res = await post(pq, { kind: ActionKind.SET_SCHEDULE_ENABLED, scheduleId: 'sch-1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/actions — add', () => {
  it('forwards every option the form can set', async () => {
    const { pq, rec } = fakePq();
    await post(pq, {
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
      data: { to: 'a@b.com' },
      priority: 5,
      idempotencyKey: 'k1',
      singletonKey: 's1',
      retry: { maxAttempts: 7 },
      preferredInstanceKeyPattern: '^eu-',
      schedule: { startAfterSeconds: 30 },
    });
  });

  it('builds a cron schedule, and prefers cron when both cadences somehow arrive', async () => {
    const { pq, rec } = fakePq({ addResult: { scheduleId: 'sch-9' } });
    const res = await post(pq, {
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
    await post(pq, {
      kind: ActionKind.ADD,
      queue: 'reports',
      add: { data: {}, startEverySeconds: 60 },
    });
    expect(rec.adds[0]).toMatchObject({ schedule: { startEverySeconds: 60 } });
  });

  it('reports a rejected add as a 400 with core’s message, not a 500', async () => {
    // A bad cron, both cadences at once, a paused queue: all actionable, none a server fault.
    const { pq } = fakePq({
      throwOn: { method: 'addJob', error: new Error('Invalid cron expression') },
    });
    const res = await post(pq, { kind: ActionKind.ADD, queue: 'emails', add: { data: {} } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid cron expression');
  });

  it('rejects an add with no payload', async () => {
    const { pq } = fakePq();
    expect((await post(pq, { kind: ActionKind.ADD, queue: 'emails' })).status).toBe(400);
  });
});

describe('POST /api/actions — malformed input', () => {
  it('rejects a body that is not JSON', async () => {
    const { pq } = fakePq();
    const router = createRouter({ portQueue: pq, basePath: '/portqueue' });
    const res = await router.handle({
      method: 'POST',
      url: '/portqueue/api/actions',
      body: 'not json',
      headers: {},
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown action kind', async () => {
    const { pq } = fakePq();
    expect((await post(pq, { kind: 'nonsense', queue: 'emails' })).status).toBe(400);
  });

  it('404s an unknown path and an unsupported method', async () => {
    const { pq } = fakePq();
    const router = createRouter({ portQueue: pq, basePath: '/portqueue' });
    const headers = {};
    expect(
      (await router.handle({ method: 'GET', url: '/portqueue/api/nope', body: undefined, headers }))
        .status,
    ).toBe(404);
    expect(
      (
        await router.handle({
          method: 'DELETE',
          url: '/portqueue/api/jobs',
          body: undefined,
          headers,
        })
      ).status,
    ).toBe(404);
  });
});
