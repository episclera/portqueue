/**
 * `portqueue doctor` — what the connection actually is, and whether the schema matches this build.
 *
 * The version comparison is the useful part: "connected" is not the same as "usable", and a schema
 * that lags the driver is the failure mode an operator most needs named rather than inferred.
 */
import { doctorCommand } from './doctor';
import { runCommand } from '../test-support/run-command';

const REPORT = {
  engine: 'sqlite',
  serverVersion: '3.45.0',
  verifiedCapabilities: [],
  queueCount: 0,
  instanceCount: 0,
};

describe('doctorCommand', () => {
  it('reports engine, schema version and counts', async () => {
    const { stdout } = await runCommand(doctorCommand);
    expect(stdout).toContain('PortQueue doctor');
    expect(stdout).toContain('sqlite');
    expect(stdout).toContain('3.45.0');
    expect(stdout).toContain('Connected, and the schema is current.');
  });

  it('warns when the applied schema lags the driver', async () => {
    const { stdout } = await runCommand(
      doctorCommand,
      {},
      { doctor: { ...REPORT, schemaVersion: 1, latestVersion: 3 } },
    );
    expect(stdout).toContain('Schema is at v1 but this driver ships v3');
  });

  it('warns when the schema has never been migrated', async () => {
    const { stdout } = await runCommand(
      doctorCommand,
      {},
      { doctor: { ...REPORT, schemaVersion: null, latestVersion: 2 } },
    );
    expect(stdout).toContain('never been migrated');
  });
});
