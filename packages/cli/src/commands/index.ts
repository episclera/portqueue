import { addCommand } from './add.js';
import { cancelCommand } from './cancel.js';
import { dashboardCommand } from './dashboard.js';
import { doctorCommand } from './doctor.js';
import { jobCommand, jobsCommand } from './jobs.js';
import { listenCommand } from './listen.js';
import { migrateCommand } from './migrate.js';
import { pauseCommand, resumeCommand } from './pause.js';
import { purgeCommand } from './purge.js';
import { queuesCommand } from './queues.js';
import { removeCommand } from './remove.js';
import { removeInstanceCommand } from './remove-instance.js';
import { removeQueueCommand } from './remove-queue.js';
import { retryCommand } from './retry.js';
import { schedulesCommand } from './schedules.js';
import { statsCommand } from './stats.js';
import type { Command } from './types.js';

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

export { CommandGroup, type Command, type CommandContext } from './types.js';
