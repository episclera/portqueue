import { flagBool } from '../args';
import { color, heading, printJson, success, table, warn } from '../output';
import { CommandGroup, type Command } from './types';

/** `portqueue doctor [--json]` */
export const doctorCommand: Command = {
  name: 'doctor',
  group: CommandGroup.Operational,
  summary: 'Check connectivity and schema health',
  usage: '[--json]',
  async run({ pq, flags }) {
    // The facade probes the live server and reads the applied schema version. Neither is on the
    // public API — `migrate()` applies migrations without reporting what state the schema was in,
    // so the old "schema is current" line was an assumption rather than a check.
    const report = await pq._cli.doctor();
    if (flagBool(flags, 'json')) return printJson(report);

    heading('PortQueue doctor');
    table(
      ['Check', 'Result'],
      [
        ['Engine', report.engine],
        ['Server version', report.serverVersion],
        ['Capabilities', report.verifiedCapabilities.join(', ') || color('none', 'dim')],
        [
          'Schema version',
          report.schemaVersion === null ? 'not migrated' : String(report.schemaVersion),
        ],
        ['Latest migration', String(report.latestVersion)],
        ['Queues', String(report.queueCount)],
        ['Instances', String(report.instanceCount)],
      ],
    );

    if (report.schemaVersion === null) {
      warn('The schema has never been migrated. Run `portqueue migrate`.');
    } else if (report.schemaVersion < report.latestVersion) {
      warn(
        `Schema is at v${report.schemaVersion} but this driver ships v${report.latestVersion}. ` +
          'Run `portqueue migrate`.',
      );
    } else {
      success('Connected, and the schema is current.');
    }
  },
};
