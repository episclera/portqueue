import type { PortQueue } from '@portqueue/core';

/** Records of the mutating calls a command made, for assertions. */
export interface FakePqCalls {
  addJob: unknown[];
  retryJob: unknown[];
  cancelJob: unknown[];
  removeJob: unknown[];
  removeJobs: unknown[];
  removeSchedule: unknown[];
  pauseQueue: unknown[];
  resumeQueue: unknown[];
  createQueue: string[];
  migrated: boolean;
}

export interface FakePqOverrides {
  stats?: unknown;
  queues?: unknown;
  jobPage?: unknown;
  job?: unknown; // returned by getJob; `null` models "not found"
  schedules?: unknown;
  addResult?: unknown;
  retryResult?: unknown;
  cancelOk?: boolean;
  removeJobOk?: boolean;
  removeScheduleOk?: boolean;
  removed?: number;
}

const DEFAULT_JOB = {
  id: 'job-abcdef123456',
  queue: 'emails',
  status: 'FAILED',
  retryAttempt: 1,
  retryMaxAttempts: 3,
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
};

/** Build a minimal fake PortQueue plus a record of the calls made through it. */
export function makeFakePq(overrides: FakePqOverrides = {}): {
  pq: PortQueue;
  calls: FakePqCalls;
} {
  const calls: FakePqCalls = {
    addJob: [],
    retryJob: [],
    cancelJob: [],
    removeJob: [],
    removeJobs: [],
    removeSchedule: [],
    pauseQueue: [],
    resumeQueue: [],
    createQueue: [],
    migrated: false,
  };

  const queue = {
    getSchedules: async () => overrides.schedules ?? [],
    addJob: async (opts: unknown) => {
      calls.addJob.push(opts);
      return overrides.addResult ?? { jobId: 'job-new', deduplicated: false };
    },
    retryJob: async (arg: unknown) => {
      calls.retryJob.push(arg);
      return overrides.retryResult ?? { jobId: 'job-retried' };
    },
    cancelJob: async (arg: unknown) => {
      calls.cancelJob.push(arg);
      return overrides.cancelOk ?? true;
    },
    removeJob: async (arg: unknown) => {
      calls.removeJob.push(arg);
      return overrides.removeJobOk ?? true;
    },
    removeSchedule: async (arg: unknown) => {
      calls.removeSchedule.push(arg);
      return overrides.removeScheduleOk ?? true;
    },
    removeJobs: async (arg: unknown) => {
      calls.removeJobs.push(arg);
      return overrides.removed ?? 3;
    },
  };

  const pq = {
    isRunning: true,
    init: async () => {},
    shutdown: async () => {},
    getQueueStats: async () =>
      overrides.stats ?? { counts: { PENDING: 2, ACTIVE: 1 }, throughputPerMinute: 5, failureRate: 0.1 },
    getQueues: async () =>
      overrides.queues ?? [
        {
          name: 'emails',
          counts: { PENDING: 2, ACTIVE: 1, COMPLETED: 9, FAILED: 0 },
          acceptingPaused: false,
          processingPaused: false,
        },
      ],
    getJobs: async () =>
      overrides.jobPage ?? { items: [DEFAULT_JOB], hasMore: false, cursor: null, total: 1 },
    getJob: async () => ('job' in overrides ? overrides.job : DEFAULT_JOB),
    createQueue: (name: string) => {
      calls.createQueue.push(name);
      return queue;
    },
    pauseQueue: async (arg: unknown) => {
      calls.pauseQueue.push(arg);
    },
    resumeQueue: async (arg: unknown) => {
      calls.resumeQueue.push(arg);
    },
    migrate: async () => {
      calls.migrated = true;
    },
    on: () => {},
  };

  return { pq: pq as unknown as PortQueue, calls };
}
