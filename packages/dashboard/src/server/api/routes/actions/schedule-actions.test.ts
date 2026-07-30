/**
 * `removeSchedule` and `setScheduleEnabled` — the schedule-scoped mutations.
 *
 * Both address a schedule by id alone: the row carries its own queue, so the client never has to know
 * it, and a removal of many ids is still one statement.
 * @jest-environment node
 */
import { fakePq, postAction } from '../../../../test-support/api';
import { ActionKind } from '../../../../shared/dto';

describe('POST /api/actions — removeSchedule', () => {
  it('removes one schedule without being told its queue', async () => {
    const { pq, rec } = fakePq();
    const res = await postAction(pq, { kind: ActionKind.REMOVE_SCHEDULE, scheduleId: 'sch-1' });
    expect(res.status).toBe(200);
    expect(rec.scheduleRemovals).toEqual([['sch-1']]);
  });

  it('removes many schedules in one call', async () => {
    const { pq, rec } = fakePq();
    const res = await postAction(pq, {
      kind: ActionKind.REMOVE_SCHEDULE,
      scheduleIds: ['sch-1', 'sch-2'],
    });
    expect(res.body).toMatchObject({ ok: true, affected: 2, requested: 2 });
    expect(rec.scheduleRemovals).toEqual([['sch-1', 'sch-2']]);
  });

  it('reports ids that matched nothing rather than inflating the count', async () => {
    const { pq } = fakePq({ schedulesRemoved: { affected: 1, requested: 2 } });
    const res = await postAction(pq, {
      kind: ActionKind.REMOVE_SCHEDULE,
      scheduleIds: ['sch-1', 'gone'],
    });
    expect(res.body).toMatchObject({ affected: 1, requested: 2 });
  });

  it('rejects a removal naming nothing', async () => {
    const { pq, rec } = fakePq();
    expect((await postAction(pq, { kind: ActionKind.REMOVE_SCHEDULE })).status).toBe(400);
    expect(rec.scheduleRemovals).toHaveLength(0);
  });
});

describe('POST /api/actions — setScheduleEnabled', () => {
  it('enables and disables a schedule', async () => {
    const { pq, rec } = fakePq();
    await postAction(pq, {
      kind: ActionKind.SET_SCHEDULE_ENABLED,
      scheduleId: 'sch-1',
      enabled: false,
    });
    await postAction(pq, {
      kind: ActionKind.SET_SCHEDULE_ENABLED,
      scheduleId: 'sch-1',
      enabled: true,
    });
    expect(rec.scheduleToggles).toEqual([
      { scheduleId: 'sch-1', enabled: false },
      { scheduleId: 'sch-1', enabled: true },
    ]);
  });

  it('requires an explicit enabled flag rather than guessing', async () => {
    // Treating a missing flag as a toggle would make the outcome depend on state the client may not
    // have refreshed, so two clicks could land as one no-op.
    const { pq, rec } = fakePq();
    const res = await postAction(pq, {
      kind: ActionKind.SET_SCHEDULE_ENABLED,
      scheduleId: 'sch-1',
    });
    expect(res.status).toBe(400);
    expect(rec.scheduleToggles).toHaveLength(0);
  });

  it('requires a scheduleId', async () => {
    const { pq } = fakePq();
    const res = await postAction(pq, { kind: ActionKind.SET_SCHEDULE_ENABLED, enabled: true });
    expect(res.status).toBe(400);
  });

  it('reports an unknown schedule as not ok, not as an error', async () => {
    const { pq } = fakePq({ scheduleEnabled: false });
    const res = await postAction(pq, {
      kind: ActionKind.SET_SCHEDULE_ENABLED,
      scheduleId: 'gone',
      enabled: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});
