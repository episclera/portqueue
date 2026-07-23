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
  command: { run: (ctx: { pq: ReturnType<typeof makeFakePq>['pq']; flags: Flags }) => Promise<void> },
  flags: Flags,
  overrides?: Parameters<typeof makeFakePq>[0],
) {
  const fake = makeFakePq(overrides);
  const output = await captureOutput(() => command.run({ pq: fake.pq, flags }));
  return { ...output, calls: fake.calls };
}

describe('statsCommand', () => {
  it('prints a table with throughput and failure rate', async () => {
    const { stdout } = await run(statsCommand, {});
    expect(stdout).toContain('Stats');
    expect(stdout).toContain('throughput');
    expect(stdout).toContain('5.0/min');
    expect(stdout).toContain('10.0%');
  });

  it('prints raw JSON with --json', async () => {
    const { stdout } = await run(statsCommand, { json: true });
    expect(stdout).toContain('"throughputPerMinute": 5');
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
  it('requires --queue', async () => {
    const fake = makeFakePq();
    await expect(schedulesCommand.run({ pq: fake.pq, flags: {} })).rejects.toThrow(/requires --queue/);
  });

  it('lists schedules for a queue', async () => {
    const { stdout } = await run(
      schedulesCommand,
      { queue: 'emails' },
      { schedules: [{ scheduleId: 'sch-daily', cron: '0 0 * * *', nextRunAt: null, enabled: true }] },
    );
    expect(stdout).toContain('sch-daily');
    expect(stdout).toContain('0 0 * * *');
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

  it('creates an interval schedule when --every is given', async () => {
    const { calls } = await run(
      addCommand,
      { queue: 'emails', data: '{"x":1}', every: '30000' },
      { addResult: { scheduleId: 'sch-3', nextRunAt: null } },
    );
    expect(calls.addJob[0]).toMatchObject({ schedule: { startEvery: 30000 } });
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

  it('removes a schedule by --schedule-id', async () => {
    const { stdout, calls } = await run(removeCommand, {
      'schedule-id': 'sch-1',
      queue: 'emails',
    });
    expect(stdout).toContain('Removed schedule sch-1');
    expect(calls.removeSchedule).toHaveLength(1);
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
    expect(calls.removeJobs).toHaveLength(1);
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

  it('reports connectivity', async () => {
    const { stdout } = await run(doctorCommand, {});
    expect(stdout).toContain('PortQueue doctor');
    expect(stdout).toContain('Connected');
  });
});
