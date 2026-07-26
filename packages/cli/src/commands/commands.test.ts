import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCommand } from './add';
import { cancelCommand } from './cancel';
import { doctorCommand } from './doctor';
import { jobCommand, jobsCommand } from './jobs';
import { migrateCommand } from './migrate';
import { pauseCommand, resumeCommand } from './pause';
import { purgeCommand } from './purge';
import { queuesCommand } from './queues';
import { removeCommand } from './remove';
import { retryCommand } from './retry';
import { schedulesCommand } from './schedules';
import { statsCommand } from './stats';
import { setColorEnabled } from '../output';
import { captureOutput } from '../test-support/capture';
import { makeFakePq } from '../test-support/fake-pq';
import type { Flags } from './types';

beforeEach(() => setColorEnabled(false));

/** Run a command against a fresh fake pq, capturing its output and calls. */
async function run(
  command: {
    run: (ctx: { pq: ReturnType<typeof makeFakePq>['pq']; flags: Flags }) => Promise<void>;
  },
  flags: Flags,
  overrides?: Parameters<typeof makeFakePq>[0],
) {
  const fake = makeFakePq(overrides);
  const output = await captureOutput(() => command.run({ pq: fake.pq, flags }));
  return { ...output, calls: fake.calls };
}

describe('statsCommand', () => {
  it('prints a table of counts by state', async () => {
    const { stdout } = await run(statsCommand, {});
    expect(stdout).toContain('Stats');
    expect(stdout).toContain('PENDING');
    expect(stdout).toContain('2');
  });

  it('prints raw JSON with --json', async () => {
    const { stdout } = await run(statsCommand, { json: true });
    expect(stdout).toContain('"PENDING": 2');
  });
});

describe('queuesCommand', () => {
  it('lists queues with counts', async () => {
    const { stdout } = await run(queuesCommand, {});
    expect(stdout).toContain('emails');
    expect(stdout).toContain('Pending');
  });
});

describe('jobsCommand', () => {
  it('renders a job row and filters by status', async () => {
    const { stdout } = await run(jobsCommand, { queue: 'emails', status: 'failed' });
    expect(stdout).toContain('job-abcdef12'); // truncated id
    expect(stdout).toContain('FAILED');
  });
});

describe('jobCommand', () => {
  it('prints the job detail', async () => {
    const { stdout } = await run(jobCommand, { id: 'job-abcdef123456' });
    expect(stdout).toContain('Job job-abcdef123456');
  });

  it('throws when the job is not found', async () => {
    const fake = makeFakePq({ job: null });
    await expect(jobCommand.run({ pq: fake.pq, flags: { id: 'missing' } })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('schedulesCommand', () => {
  const SCHEDULES = [
    { scheduleId: 'sch-daily', queue: 'emails', cron: '0 0 * * *', nextRunAt: null, enabled: true },
  ];

  it('lists every queue\u2019s schedules when --queue is omitted', async () => {
    const { stdout } = await run(schedulesCommand, {}, { schedules: SCHEDULES });
    expect(stdout).toContain('all queues');
    expect(stdout).toContain('sch-daily');
  });

  it('lists schedules for a queue', async () => {
    const { stdout } = await run(schedulesCommand, { queue: 'emails' }, { schedules: SCHEDULES });
    expect(stdout).toContain('sch-daily');
    expect(stdout).toContain('0 0 * * *');
  });

  // Reading schedules must not claim the queue in this admin process (see the _cli facade).
  it('never registers a queue in this process', async () => {
    const { calls } = await run(schedulesCommand, { queue: 'emails' }, { schedules: SCHEDULES });
    expect(calls.createQueue).toEqual([]);
  });
});

describe('addCommand', () => {
  it('enqueues a job from inline JSON', async () => {
    const { stdout, calls } = await run(addCommand, { queue: 'emails', data: '{"to":"a@b.com"}' });
    expect(stdout).toContain('Job job-new added');
    expect(calls.addJob).toHaveLength(1);
    expect(calls.addJob[0]).toMatchObject({ data: { to: 'a@b.com' } });
  });

  it('reads --data from a @file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pq-cli-'));
    const file = join(dir, 'payload.json');
    writeFileSync(file, '{"from":"file"}');
    const { calls } = await run(addCommand, { queue: 'emails', data: `@${file}` });
    expect(calls.addJob[0]).toMatchObject({ data: { from: 'file' } });
  });

  it('creates a schedule when --cron is given', async () => {
    const { stdout, calls } = await run(
      addCommand,
      { queue: 'emails', data: '{"x":1}', cron: '0 0 * * *' },
      { addResult: { scheduleId: 'sch-1', nextRunAt: null } },
    );
    expect(stdout).toContain('Schedule sch-1 created');
    expect(calls.addJob[0]).toMatchObject({ schedule: { cron: '0 0 * * *' } });
  });

  it('creates a cron schedule with a timezone object when --timezone is given', async () => {
    const { calls } = await run(
      addCommand,
      { queue: 'emails', data: '{"x":1}', cron: '0 8 * * *', timezone: 'America/New_York' },
      { addResult: { scheduleId: 'sch-2', nextRunAt: null } },
    );
    expect(calls.addJob[0]).toMatchObject({
      schedule: { cron: { pattern: '0 8 * * *', tz: 'America/New_York' } },
    });
  });

  it('creates an interval schedule in seconds when --every is given', async () => {
    const { calls } = await run(
      addCommand,
      { queue: 'emails', data: '{"x":1}', every: '30' },
      { addResult: { scheduleId: 'sch-3', nextRunAt: null } },
    );
    expect(calls.addJob[0]).toMatchObject({ schedule: { startEverySeconds: 30 } });
  });

  it('reads --start-after as a delay in seconds', async () => {
    const { calls } = await run(addCommand, {
      queue: 'emails',
      data: '{"x":1}',
      'start-after': '45',
    });
    expect(calls.addJob[0]).toMatchObject({ schedule: { startAfterSeconds: 45 } });
  });

  it('rejects a --start-after that is not whole seconds', async () => {
    await expect(
      run(addCommand, { queue: 'emails', data: '{"x":1}', 'start-after': '2026-01-01T00:00:00Z' }),
    ).rejects.toThrow(/not a whole number of seconds/);
    await expect(
      run(addCommand, { queue: 'emails', data: '{"x":1}', 'start-after': '1.5' }),
    ).rejects.toThrow(/not a whole number of seconds/);
  });
});

describe('retryCommand', () => {
  it('requeues an existing job', async () => {
    const { stdout, calls } = await run(retryCommand, { id: 'job-abcdef123456' });
    expect(stdout).toContain('Requeued job job-abcdef123456');
    expect(stdout).toContain('job-retried');
    expect(calls.retryJob).toHaveLength(1);
  });
});

describe('cancelCommand', () => {
  it('reports success when cancelled', async () => {
    const { stdout } = await run(cancelCommand, { id: 'job-abcdef123456' }, { cancelOk: true });
    expect(stdout).toContain('Cancelled job');
  });

  it('warns when the job cannot be cancelled', async () => {
    const { stdout } = await run(cancelCommand, { id: 'job-abcdef123456' }, { cancelOk: false });
    expect(stdout).toContain('could not be cancelled');
  });
});

describe('removeCommand', () => {
  it('removes a job by --id', async () => {
    const { stdout, calls } = await run(removeCommand, { id: 'job-abcdef123456' });
    expect(stdout).toContain('Removed job');
    expect(calls.removeJob).toHaveLength(1);
  });

  // The facade resolves the queue from the schedule id, so --queue is no longer required.
  it('removes a schedule by --schedule-id alone', async () => {
    const { stdout, calls } = await run(removeCommand, { 'schedule-id': 'sch-1' });
    expect(stdout).toContain('Removed schedule sch-1');
    expect(calls.removeSchedule).toEqual([{ scheduleId: 'sch-1' }]);
    expect(calls.createQueue).toEqual([]);
  });

  it('rejects when neither or both selectors are given', async () => {
    const fake = makeFakePq();
    await expect(removeCommand.run({ pq: fake.pq, flags: {} })).rejects.toThrow(/exactly one/);
    await expect(
      removeCommand.run({ pq: fake.pq, flags: { id: 'a', 'schedule-id': 'b' } }),
    ).rejects.toThrow(/exactly one/);
  });
});

describe('purgeCommand', () => {
  it('requires --yes to confirm', async () => {
    const fake = makeFakePq();
    await expect(
      purgeCommand.run({ pq: fake.pq, flags: { queue: 'emails', status: 'failed' } }),
    ).rejects.toThrow(/pass --yes/);
  });

  it('purges when confirmed', async () => {
    const { stdout, calls } = await run(
      purgeCommand,
      { queue: 'emails', status: 'failed', yes: true },
      { removed: 7 },
    );
    expect(stdout).toContain('Purged 7');
    expect(calls.purge).toEqual([{ queue: 'emails', statuses: ['FAILED'] }]);
    // Purging addresses the queue by name; it must not register it here.
    expect(calls.createQueue).toEqual([]);
  });
});

describe('pause/resume', () => {
  it('pauses a queue', async () => {
    const { stdout, calls } = await run(pauseCommand, { queue: 'emails', mode: 'all' });
    expect(stdout).toContain("Paused 'emails'");
    expect(calls.pauseQueue).toHaveLength(1);
  });

  it('resumes a queue', async () => {
    const { stdout, calls } = await run(resumeCommand, { queue: 'emails' });
    expect(stdout).toContain("Resumed 'emails'");
    expect(calls.resumeQueue).toHaveLength(1);
  });
});

describe('migrate/doctor', () => {
  it('runs migrations', async () => {
    const { stdout, calls } = await run(migrateCommand, {});
    expect(stdout).toContain('Migrations applied');
    expect(calls.migrated).toBe(true);
  });

  it('reports engine, schema version and counts', async () => {
    const { stdout } = await run(doctorCommand, {});
    expect(stdout).toContain('PortQueue doctor');
    expect(stdout).toContain('sqlite');
    expect(stdout).toContain('3.45.0');
    expect(stdout).toContain('Connected, and the schema is current.');
  });

  it('warns when the applied schema lags the driver', async () => {
    const { stdout } = await run(
      doctorCommand,
      {},
      {
        doctor: {
          ...{
            engine: 'sqlite',
            serverVersion: '3.45.0',
            verifiedCapabilities: [],
            queueCount: 0,
            instanceCount: 0,
          },
          schemaVersion: 1,
          latestVersion: 3,
        },
      },
    );
    expect(stdout).toContain('Schema is at v1 but this driver ships v3');
  });

  it('warns when the schema has never been migrated', async () => {
    const { stdout } = await run(
      doctorCommand,
      {},
      {
        doctor: {
          engine: 'sqlite',
          serverVersion: '3.45.0',
          verifiedCapabilities: [],
          queueCount: 0,
          instanceCount: 0,
          schemaVersion: null,
          latestVersion: 2,
        },
      },
    );
    expect(stdout).toContain('never been migrated');
  });
});
