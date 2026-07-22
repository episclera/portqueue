import type { PortQueue } from '@portqueue/core';
import type { ParsedArgs } from '../args.js';

export type Flags = ParsedArgs['flags'];

/** Everything a command needs to run: the resolved instance + parsed flags. */
export interface CommandContext {
  readonly pq: PortQueue;
  readonly flags: Flags;
}

/** Section a command appears under in the generated help output. */
export enum CommandGroup {
  Monitoring = 'Monitoring',
  Actions = 'Actions',
  Operational = 'Operational',
}

/**
 * A self-describing CLI command. The registry (`commands/index.ts`) derives both
 * dispatch and help from this shape, so there is no separate map or help string to
 * keep in sync. Options arrive as a single named `CommandContext` — never positional.
 */
export interface Command {
  readonly name: string;
  readonly group: CommandGroup;
  /** One-line summary shown in help. */
  readonly summary: string;
  /** Argument spec shown after the command name in help (flags etc.). */
  readonly usage?: string;
  /** Long-running commands (stream/serve) keep the instance alive after `run` returns. */
  readonly persistent?: boolean;
  run(ctx: CommandContext): Promise<void>;
}
