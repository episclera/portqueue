import { addCommand } from './add';
import { cancelCommand } from './cancel';
import { dashboardCommand } from './dashboard';
import { doctorCommand } from './doctor';
import { jobCommand, jobsCommand } from './jobs';
import { listenCommand } from './listen';
import { migrateCommand } from './migrate';
import { pauseCommand, resumeCommand } from './pause';
import { purgeCommand } from './purge';
import { queuesCommand } from './queues';
import { removeCommand } from './remove';
import { removeInstanceCommand } from './remove-instance';
import { removeQueueCommand } from './remove-queue';
import { retryCommand } from './retry';
import { schedulesCommand } from './schedules';
import { statsCommand } from './stats';
import type { Command } from './types';

/**
 * The command registry. Both dispatch (`COMMANDS_BY_NAME`) and the generated help
 * are derived from this single list — add a command here and it appears everywhere.
 */
export const COMMANDS: readonly Command[] = [
  // Monitoring
  statsCommand,
  queuesCommand,
  jobsCommand,
  jobCommand,
  schedulesCommand,
  // Actions
  addCommand,
  retryCommand,
  cancelCommand,
  removeCommand,
  removeQueueCommand,
  removeInstanceCommand,
  purgeCommand,
  pauseCommand,
  resumeCommand,
  // Operational
  migrateCommand,
  doctorCommand,
  listenCommand,
  dashboardCommand,
];

export const COMMANDS_BY_NAME: ReadonlyMap<string, Command> = new Map(
  COMMANDS.map((command) => [command.name, command]),
);

export { CommandGroup, type Command, type CommandContext } from './types';
