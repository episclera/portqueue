/**
 * `portqueue instances` / `portqueue instance` — liveness and **process** health.
 *
 * The health columns say whose numbers they are on purpose: they are this process's CPU share of the
 * cores available to it and its heap share of V8's limit, not the machine's.
 */
import { instanceCommand, instancesCommand } from './instances';
import { runCommand } from '../test-support/run-command';

describe('instancesCommand', () => {
  it('lists liveness, process health and a processed total', async () => {
    const { stdout } = await runCommand(instancesCommand);
    expect(stdout).toContain('worker-eu-1');
    expect(stdout).toContain('CPU (proc)');
    expect(stdout).toContain('Mem (proc)');
    expect(stdout).toContain('12.5%');
    expect(stdout).toContain('94.2%');
    expect(stdout).not.toContain('RSS');
    // 8 completed + 1 failed, as one number rather than a column per status.
    expect(stdout).toContain('9');
  });

  it('prints an em dash for an instance that has not beaten yet', async () => {
    // `0.0%` would claim a reading we don't have; the dash says there isn't one.
    const { stdout } = await runCommand(
      instancesCommand,
      {},
      {
        instances: [
          {
            instanceKey: 'fresh',
            processingPaused: false,
            alive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSeenAt: new Date(),
            cpuPercent: null,
            memoryPercent: null,
            counts: {},
          },
        ],
      },
    );
    expect(stdout).toContain('—');
    expect(stdout).not.toContain('0.0%');
  });

  it('never declares a queue in this admin process', async () => {
    const { calls } = await runCommand(instancesCommand);
    expect(calls.createQueue).toEqual([]);
  });
});

describe('instanceCommand', () => {
  it('prints one instance with its health and per-status counts', async () => {
    const { stdout } = await runCommand(instanceCommand, { key: 'worker-eu-1' });
    expect(stdout).toContain('Instance worker-eu-1');
    // Spelled out in the detail view: whose CPU, and what the memory share is of.
    expect(stdout).toContain('CPU (process, % of all cores)');
    expect(stdout).toContain('Memory (process, % of heap limit)');
    expect(stdout).toContain('12.5%');
    expect(stdout).toContain('COMPLETED');
    expect(stdout).toContain('TOTAL');
  });

  it('throws when the key is missing or unknown', async () => {
    await expect(runCommand(instanceCommand)).rejects.toThrow(/Missing required --key/);
    await expect(runCommand(instanceCommand, { key: 'nope' })).rejects.toThrow(/not found/);
  });
});
