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
});
