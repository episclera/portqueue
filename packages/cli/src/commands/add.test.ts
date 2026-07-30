/**
 * `portqueue add` — enqueue a job, or create a recurring schedule.
 *
 * Two things carry the weight here: `--data` accepts inline JSON or `@file` (a shell can't reliably
 * quote a large payload), and every duration flag is a **whole number of seconds** — the CLI rejects
 * anything else rather than guessing a unit, which is the same rule the library holds everywhere.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCommand } from './add';
import { runCommand } from '../test-support/run-command';

describe('addCommand — payload', () => {
  it('enqueues a job from inline JSON', async () => {
    const { stdout, calls } = await runCommand(addCommand, {
      queue: 'emails',
      data: '{"to":"a@b.com"}',
    });
    expect(stdout).toContain('Job job-new added');
    expect(calls.addJob).toHaveLength(1);
    expect(calls.addJob[0]).toMatchObject({ queue: 'emails', data: { to: 'a@b.com' } });
  });

  it('reads --data from a @file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pq-cli-'));
    const file = join(dir, 'payload.json');
    writeFileSync(file, '{"from":"file"}');
    const { calls } = await runCommand(addCommand, { queue: 'emails', data: `@${file}` });
    expect(calls.addJob[0]).toMatchObject({ data: { from: 'file' } });
  });

  it('addresses the queue by name rather than declaring it', async () => {
    const { calls } = await runCommand(addCommand, { queue: 'emails', data: '{}' });
    expect(calls.createQueue).toEqual([]);
  });
});

describe('addCommand — scheduling', () => {
  it('creates a schedule when --cron is given', async () => {
    const { stdout, calls } = await runCommand(
      addCommand,
      { queue: 'emails', data: '{"x":1}', cron: '0 0 * * *' },
      { addResult: { scheduleId: 'sch-1', nextRunAt: null } },
    );
    expect(stdout).toContain('Schedule sch-1 created');
    expect(calls.addJob[0]).toMatchObject({ schedule: { cron: '0 0 * * *' } });
  });

  it('creates a cron schedule with a timezone object when --timezone is given', async () => {
    const { calls } = await runCommand(
      addCommand,
      { queue: 'emails', data: '{"x":1}', cron: '0 8 * * *', timezone: 'America/New_York' },
      { addResult: { scheduleId: 'sch-2', nextRunAt: null } },
    );
    expect(calls.addJob[0]).toMatchObject({
      schedule: { cron: { pattern: '0 8 * * *', tz: 'America/New_York' } },
    });
  });

  it('creates an interval schedule in seconds when --every is given', async () => {
    const { calls } = await runCommand(
      addCommand,
      { queue: 'emails', data: '{"x":1}', every: '30' },
      { addResult: { scheduleId: 'sch-3', nextRunAt: null } },
    );
    expect(calls.addJob[0]).toMatchObject({ schedule: { startEverySeconds: 30 } });
  });

  it('reads --start-after as a delay in seconds', async () => {
    const { calls } = await runCommand(addCommand, {
      queue: 'emails',
      data: '{"x":1}',
      'start-after': '45',
    });
    expect(calls.addJob[0]).toMatchObject({ schedule: { startAfterSeconds: 45 } });
  });

  it('rejects a --start-after that is not whole seconds', async () => {
    // A date and a fraction are both plausible things to type, and both would be silently wrong —
    // so neither is accepted.
    await expect(
      runCommand(addCommand, {
        queue: 'emails',
        data: '{"x":1}',
        'start-after': '2026-01-01T00:00:00Z',
      }),
    ).rejects.toThrow(/not a whole number of seconds/);
    await expect(
      runCommand(addCommand, { queue: 'emails', data: '{"x":1}', 'start-after': '1.5' }),
    ).rejects.toThrow(/not a whole number of seconds/);
  });
});
