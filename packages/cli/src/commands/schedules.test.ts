/** `portqueue schedules` — a page of recurrences, for one queue or across every queue. */
import { schedulesCommand } from './schedules';
import { runCommand } from '../test-support/run-command';

const SCHEDULES = [
  { scheduleId: 'sch-daily', queue: 'emails', cron: '0 0 * * *', nextRunAt: null, enabled: true },
];

describe('schedulesCommand', () => {
  it('lists every queue’s schedules when --queue is omitted', async () => {
    const { stdout } = await runCommand(schedulesCommand, {}, { schedules: SCHEDULES });
    expect(stdout).toContain('all queues');
    expect(stdout).toContain('sch-daily');
  });

  it('lists schedules for one queue', async () => {
    const { stdout } = await runCommand(
      schedulesCommand,
      { queue: 'emails' },
      { schedules: SCHEDULES },
    );
    expect(stdout).toContain('sch-daily');
    expect(stdout).toContain('0 0 * * *');
  });

  it('says how many of the total it is showing, because the read is paged', async () => {
    // This used to load every schedule row in the database into the terminal; the heading is what
    // tells you there may be more.
    const { stdout } = await runCommand(schedulesCommand, {}, { schedules: SCHEDULES });
    expect(stdout).toContain('showing 1 of 1');
  });

  it('never declares a queue in this admin process', async () => {
    const { calls } = await runCommand(
      schedulesCommand,
      { queue: 'emails' },
      { schedules: SCHEDULES },
    );
    expect(calls.createQueue).toEqual([]);
  });

  it('hands --limit/--offset to the paged read', async () => {
    const { calls } = await runCommand(
      schedulesCommand,
      { queue: 'emails', limit: '1', offset: '0' },
      { schedules: SCHEDULES },
    );
    // `0` is a real offset, not "unset".
    expect(calls.getSchedules).toEqual([{ queue: 'emails', limit: 1, offset: 0 }]);
  });

  it('prints the same "more" hint as every other paged list', async () => {
    const { stdout } = await runCommand(
      schedulesCommand,
      { limit: '1', offset: '3' },
      { schedules: SCHEDULES, scheduleTotal: 10 },
    );
    expect(stdout).toContain('use --offset 4');
  });

  it('rejects a limit below 1', async () => {
    await expect(runCommand(schedulesCommand, { limit: '0' })).rejects.toThrow(/--limit/);
  });
});
