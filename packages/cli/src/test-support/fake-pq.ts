import { CancelOutcome, JobNotFoundError } from '@portqueue/core';
import type { PortQueue } from '@portqueue/core';

/** Records of the mutating calls a command made, for assertions. */
export interface FakePqCalls {
  addJob: unknown[];
  retryJob: unknown[];
  cancelJob: unknown[];
  removeJob: unknown[];
  /** `pq._cli.purge(...)` — the facade path a purge takes. */
  purge: unknown[];
  removeSchedule: unknown[];
  pauseQueue: unknown[];
  resumeQueue: unknown[];
  /**
   * Queue names this command declared in the process. **Every command must leave this empty**: the
   * CLI runs a headless client and addresses every queue by name, so nothing it does should ever
   * declare one.
   */
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
  /** What `cancelJob` answers. `null` models the id matching no row, which core throws for. */
  cancelOutcome?: CancelOutcome | null;
  removeJobOk?: boolean;
  removeScheduleOk?: boolean;
  removed?: number;
  doctor?: unknown;
  instances?: unknown;
}

const DEFAULT_JOB = {
  id: 'job-abcdef123456',
  queue: 'emails',
  status: 'FAILED',
  retryAttempt: 1,
  retryMaxAttempts: 3,
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
};

const DEFAULT_INSTANCE = {
  instanceKey: 'worker-eu-1',
  processingPaused: false,
  alive: true,
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  updatedAt: new Date('2026-07-22T00:02:00.000Z'),
  lastSeenAt: new Date('2026-07-22T00:02:00.000Z'),
  cpuPercent: 12.5,
  memoryPercent: 94.2,
  counts: { COMPLETED: 8, FAILED: 1 },
};

const DEFAULT_DOCTOR = {
  engine: 'sqlite',
  serverVersion: '3.45.0',
  verifiedCapabilities: ['TRANSACTIONS'],
  schemaVersion: 1,
  latestVersion: 1,
  queueCount: 1,
  instanceCount: 0,
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
    purge: [],
    removeSchedule: [],
    pauseQueue: [],
    resumeQueue: [],
    createQueue: [],
    migrated: false,
  };

  /** The `pq._cli` facade the CLI reaches for instead of widening the public API. */
  const cli = {
    getSchedules: async () => {
      const items = (overrides.schedules ?? []) as unknown[];
      return { items, total: items.length };
    },
    purge: async (arg: unknown) => {
      calls.purge.push(arg);
      return overrides.removed ?? 3;
    },
    doctor: async () => overrides.doctor ?? DEFAULT_DOCTOR,
    driver: {} as never,
  };

  const pq = {
    isRunning: true,
    init: async () => {},
    shutdown: async () => {},
    _cli: cli,
    getQueueStats: async () => overrides.stats ?? { counts: { PENDING: 2, ACTIVE: 1 } },
    getQueues: async () => {
      const items = (overrides.queues ?? [
        {
          name: 'emails',
          counts: { PENDING: 2, ACTIVE: 1, COMPLETED: 9, FAILED: 0 },
          acceptingPaused: false,
          processingPaused: false,
        },
      ]) as unknown[];
      return { items, total: items.length };
    },
    getJobs: async () => overrides.jobPage ?? { items: [DEFAULT_JOB], total: 1 },
    getJob: async () => ('job' in overrides ? overrides.job : DEFAULT_JOB),
    getInstances: async () => {
      const items = (overrides.instances ?? [DEFAULT_INSTANCE]) as unknown[];
      return { items, total: items.length };
    },
    getInstance: async ({ instanceKey }: { instanceKey: string }) => {
      const items = (overrides.instances ?? [DEFAULT_INSTANCE]) as { instanceKey: string }[];
      return items.find((i) => i.instanceKey === instanceKey) ?? null;
    },
    addJob: async (opts: unknown) => {
      calls.addJob.push(opts);
      return overrides.addResult ?? { jobId: 'job-new', deduplicated: false };
    },
    retryJob: async (arg: unknown) => {
      calls.retryJob.push(arg);
      return 'retryResult' in overrides
        ? overrides.retryResult
        : { jobId: 'job-abcdef123456', queue: 'emails', status: 'PENDING' };
    },
    cancelJob: async (arg: unknown) => {
      calls.cancelJob.push(arg);
      const outcome =
        'cancelOutcome' in overrides ? overrides.cancelOutcome : CancelOutcome.CANCELLED;
      if (outcome === null) throw new JobNotFoundError((arg as { jobId: string }).jobId);
      return outcome;
    },
    removeJob: async (arg: unknown) => {
      calls.removeJob.push(arg);
      return overrides.removeJobOk ?? true;
    },
    removeSchedule: async (arg: unknown) => {
      calls.removeSchedule.push(arg);
      return overrides.removeScheduleOk ?? true;
    },
    createQueue: (options: { name: string }) => {
      calls.createQueue.push(options.name);
      return { name: options.name };
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
