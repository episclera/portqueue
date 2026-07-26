/** @jest-environment node */
import type { InstanceInfo, JobSnapshot } from '@portqueue/core';
import { serializeInstance, serializeJob, serializeSchedule, serializeStats } from './serialize';

const baseJob = (over: Partial<JobSnapshot> = {}): JobSnapshot =>
  ({
    id: 'job-1',
    queue: 'emails',
    status: 'COMPLETED',
    data: { to: 'a@b.com' },
    priority: 0,
    retryAttempt: 0,
    retryMaxAttempts: 3,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:01:00.000Z'),
    startAfter: new Date('2026-07-22T00:00:00.000Z'),
    completedAt: new Date('2026-07-22T00:02:00.000Z'),
    startedAt: null,
    failedAt: null,
    stalled: false,
    ...over,
  }) as unknown as JobSnapshot;

describe('serializeJob', () => {
  it('converts Dates to ISO strings and preserves null/undefined', () => {
    const dto = serializeJob(baseJob());
    expect(dto.createdAt).toBe('2026-07-22T00:00:00.000Z');
    expect(dto.completedAt).toBe('2026-07-22T00:02:00.000Z');
    expect(dto.startedAt).toBeNull();
  });
});

describe('serializeStats', () => {
  it('omits queue when undefined and copies counts', () => {
    const dto = serializeStats({ counts: { PENDING: 1 } } as never);
    expect('queue' in dto).toBe(false);
    expect(dto.counts).toEqual({ PENDING: 1 });
  });

  it('includes queue when present', () => {
    const dto = serializeStats({ queue: 'emails', counts: {} } as never);
    expect(dto.queue).toBe('emails');
  });
});

describe('serializeSchedule', () => {
  it('stamps the queue and ISO-formats dates', () => {
    // The queue rides on the schedule itself now: core's dashboard facade returns it, so the
    // serializer no longer has to be told which queue a schedule belongs to.
    const dto = serializeSchedule({
      scheduleId: 'sch-1',
      queue: 'reports',
      cron: '0 0 * * *',
      everySeconds: null,
      timezone: 'UTC',
      nextRunAt: new Date('2026-07-23T00:00:00.000Z'),
      lastRunAt: null,
      enabled: true,
    });
    expect(dto.queue).toBe('reports');
    expect(dto.nextRunAt).toBe('2026-07-23T00:00:00.000Z');
    expect(dto.lastRunAt).toBeNull();
  });
});

describe('serializeInstance', () => {
  it('ISO-formats timestamps and copies liveness, health + counts', () => {
    const info: InstanceInfo = {
      instanceKey: 'worker-eu-1',
      processingPaused: true,
      alive: true,
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      updatedAt: new Date('2026-07-22T00:01:00.000Z'),
      lastSeenAt: new Date('2026-07-22T00:02:00.000Z'),
      cpuPercent: 42.5,
      memoryPercent: 18.25,
      rssBytes: 1_234_567,
      counts: { COMPLETED: 3 } as never,
    };
    const dto = serializeInstance(info);
    expect(dto.instanceKey).toBe('worker-eu-1');
    expect(dto.processingPaused).toBe(true);
    expect(dto.alive).toBe(true);
    expect(dto.cpuPercent).toBe(42.5);
    expect(dto.memoryPercent).toBe(18.25);
    expect(dto.rssBytes).toBe(1_234_567);
    expect(dto.lastSeenAt).toBe('2026-07-22T00:02:00.000Z');
    expect(dto.counts).toEqual({ COMPLETED: 3 });
  });
});
