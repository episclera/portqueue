import type { LogLevel } from './log-level.enum';

/** Structured log context — no positional interpolation. */
export interface LogContext {
  queue?: string;
  jobId?: string;
  scheduleId?: string;
  workflowId?: string;
  instanceId?: string;
  err?: unknown;
  [key: string]: unknown;
}

/**
 * The logger contract. Injected at construction; core never imports
 * a logging library. Bring your own by implementing this interface.
 */
export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
}

/** Options for the built-in console logger. */
export interface LoggerOptions {
  level?: LogLevel;
  /** Pretty (human) vs JSON lines. Default: pretty when stdout is a TTY. */
  pretty?: boolean;
}
