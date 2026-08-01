import type { PortQueue } from '@portqueue/core';
import type { ParsedArgs } from '../args';

export type Flags = ParsedArgs['flags'];

/** Something a command opened and the runner must close on the way out. */
export type Teardown = () => void | Promise<void>;

/** Everything a command needs to run: the resolved instance + parsed flags. */
export interface CommandContext {
  readonly pq: PortQueue;
  readonly flags: Flags;
  /**
   * Register a resource to release when the process stops — a listening server, an interval, a
   * dashboard mount. The runner calls these newest-first before shutting the client down, on a clean
   * exit, on a signal, and on a throw. A persistent command that opens anything must use this: an
   * interval whose handle is dropped keeps the loop alive with nothing to stop it, and a bound port
   * outlives the client it was serving.
   */
  readonly onExit: (teardown: Teardown) => void;
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
