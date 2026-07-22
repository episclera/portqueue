/** @jest-environment node */
import type { InstanceInfo, JobSnapshot } from '@portqueue/core';
import {
  serializeInstance,
  serializeJob,
  serializeSchedule,
  serializeStats,
} from './serialize.js';

const baseJob = (over: Partial<JobSnapshot> = {}): JobSnapshot =>
  ({
    id: 'job-1',
    queue: 'emails',
    status: 'COMPLETED',
    data: { to: 'a@b.com' },
    metadata: {},
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
    const dto = serializeStats({
      counts: { PENDING: 1 },
      throughputPerMinute: 2,
      failureRate: 0.5,
    } as never);
    expect('queue' in dto).toBe(false);
    expect(dto.counts).toEqual({ PENDING: 1 });
  });

  it('includes queue when present', () => {
    const dto = serializeStats({
      queue: 'emails',
      counts: {},
      throughputPerMinute: 0,
      failureRate: 0,
    } as never);
    expect(dto.queue).toBe('emails');
  });
});

describe('serializeSchedule', () => {
  it('stamps the queue and ISO-formats dates', () => {
    const dto = serializeSchedule(
      {
        scheduleId: 'sch-1',
        cron: '0 0 * * *',
        every: null,
        timezone: 'UTC',
        nextRunAt: new Date('2026-07-23T00:00:00.000Z'),
        lastRunAt: null,
        enabled: true,
      } as never,
      'reports',
    );
    expect(dto.queue).toBe('reports');
    expect(dto.nextRunAt).toBe('2026-07-23T00:00:00.000Z');
    expect(dto.lastRunAt).toBeNull();
  });
});

describe('serializeInstance', () => {
  it('ISO-formats timestamps and copies liveness + counts', () => {
    const info: InstanceInfo = {
      instanceKey: 'worker-eu-1',
      processingPaused: true,
      alive: true,
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      updatedAt: new Date('2026-07-22T00:01:00.000Z'),
      lastSeenAt: new Date('2026-07-22T00:02:00.000Z'),
      counts: { COMPLETED: 3 } as never,
    };
    const dto = serializeInstance(info);
    expect(dto.instanceKey).toBe('worker-eu-1');
    expect(dto.processingPaused).toBe(true);
    expect(dto.alive).toBe(true);
    expect(dto.lastSeenAt).toBe('2026-07-22T00:02:00.000Z');
    expect(dto.counts).toEqual({ COMPLETED: 3 });
  });
});
