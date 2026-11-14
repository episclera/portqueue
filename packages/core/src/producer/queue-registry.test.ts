/**
 * `QueueRegistry` — the cached queue rows and pause flags the claim loop reads with no I/O.
 *
 * The driver is a hand-rolled stub of the four methods the registry calls, so each test can count
 * round trips: the tick's refresh used to issue one query per declared queue.
 */
import { QueueNotFoundError } from '../errors/errors';
import { FakeClock } from '../util/clock';
import { secondsToMs } from '../util/seconds';
import { QueueRegistry } from './queue-registry';
import type { Driver } from '../drivers/driver.interface';
import type { QueueRow } from '../jobs/job-record';

const TICK_SECONDS = 5;

function row(name: string, processingPaused = false): QueueRow {
  return { name, processingPaused, acceptingPaused: false, createdAt: 0, updatedAt: 0 };
}

/** A driver that records each call and answers from an in-memory table. */
function stubDriver(table: Map<string, QueueRow>) {
  const calls = { ensureQueue: 0, listQueues: 0, getQueueByName: 0, listedNames: [] as string[][] };
  const driver = {
    ensureQueue: async ({ name }: { name: string }) => {
      calls.ensureQueue += 1;
      if (!table.has(name)) table.set(name, row(name));
      return table.get(name)!;
    },
    listQueues: async ({ names }: { names?: string[] } = {}) => {
      calls.listQueues += 1;
      if (names) calls.listedNames.push(names);
      return [...table.values()].filter((r) => !names || names.includes(r.name));
    },
    getQueueByName: async ({ name }: { name: string }) => {
      calls.getQueueByName += 1;
      return table.get(name) ?? null;
    },
  } as unknown as Driver;
  return { driver, calls };
}

describe('QueueRegistry', () => {
  it('refreshes every stale queue with one query, whatever the declaration count', async () => {
    const table = new Map<string, QueueRow>();
    const { driver, calls } = stubDriver(table);
    const clock = new FakeClock(1_000);
    const registry = new QueueRegistry(driver, clock, { tickIntervalSeconds: TICK_SECONDS });
    const names = Array.from({ length: 25 }, (_, i) => `q${i}`);
    for (const name of names) await registry.ensure(name);

    // Another instance pauses two of them.
    table.set('q3', row('q3', true));
    table.set('q17', row('q17', true));

    clock.advance(secondsToMs(TICK_SECONDS, 'tick'));
    await registry.refreshStale();

    expect(calls.listQueues).toBe(1);
    // Filtered in SQL to the declared names — never the whole table.
    expect(calls.listedNames).toEqual([names]);
    expect(calls.getQueueByName).toBe(0);
    expect(registry.pauseState('q3')?.processingPaused).toBe(true);
    expect(registry.pauseState('q17')?.processingPaused).toBe(true);
    expect(registry.pauseState('q4')?.processingPaused).toBe(false);
  });

  it('issues no query at all while every cached flag is still fresh', async () => {
    const { driver, calls } = stubDriver(new Map());
    const clock = new FakeClock(1_000);
    const registry = new QueueRegistry(driver, clock, { tickIntervalSeconds: TICK_SECONDS });
    await registry.ensure('emails');

    await registry.refreshStale();

    expect(calls.listQueues).toBe(0);
  });

  it('keeps the cached flags when the refresh read fails', async () => {
    const table = new Map<string, QueueRow>();
    const { driver } = stubDriver(table);
    const clock = new FakeClock(1_000);
    const registry = new QueueRegistry(driver, clock, { tickIntervalSeconds: TICK_SECONDS });
    await registry.ensure('emails');
    (driver as unknown as { listQueues: () => Promise<never> }).listQueues = async () => {
      throw new Error('connection reset');
    };

    clock.advance(secondsToMs(TICK_SECONDS, 'tick'));
    await expect(registry.refreshStale()).resolves.toBeUndefined();
    expect(registry.pauseState('emails')).toEqual({
      processingPaused: false,
      acceptingPaused: false,
    });
  });

  it('ensures a row once under concurrent callers', async () => {
    const { driver, calls } = stubDriver(new Map());
    const registry = new QueueRegistry(driver, new FakeClock(0));

    await Promise.all([registry.ensure('emails'), registry.ensure('emails')]);

    expect(calls.ensureQueue).toBe(1);
  });

  it('never writes on a headless client: declare is a no-op and ensure only reads', async () => {
    const { driver, calls } = stubDriver(new Map());
    const registry = new QueueRegistry(driver, new FakeClock(0), { headless: true });

    registry.declare('emails', { defaultJobOptions: { priority: 5 } });

    expect(registry.isRegistered('emails')).toBe(false);
    expect(registry.getOptions('emails')).toEqual({});
    await expect(registry.ensure('emails')).rejects.toBeInstanceOf(QueueNotFoundError);
    expect(calls.ensureQueue).toBe(0);
  });
});
