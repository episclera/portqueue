import { LOG_LEVEL_SEVERITY, LogLevel } from './log-level.enum';
import type { Logger, LogContext, LoggerOptions } from './logger.interface';

/**
 * Zero-dependency default logger. Writes structured lines to
 * stdout/stderr honoring the configured level.
 */
export class ConsoleLogger implements Logger {
  private readonly minSeverity: number;
  private readonly pretty: boolean;

  constructor(options: LoggerOptions = {}) {
    const level = options.level ?? LogLevel.INFO;
    this.minSeverity = LOG_LEVEL_SEVERITY[level];
    this.pretty = options.pretty ?? Boolean(process.stdout.isTTY);
  }

  trace(message: string, context?: LogContext): void {
    this.write(LogLevel.TRACE, message, context);
  }
  debug(message: string, context?: LogContext): void {
    this.write(LogLevel.DEBUG, message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write(LogLevel.INFO, message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write(LogLevel.WARN, message, context);
  }
  error(message: string, context?: LogContext): void {
    this.write(LogLevel.ERROR, message, context);
  }
  fatal(message: string, context?: LogContext): void {
    this.write(LogLevel.FATAL, message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVEL_SEVERITY[level] < this.minSeverity) return;
    const stream =
      LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[LogLevel.ERROR]
        ? process.stderr
        : process.stdout;
    const normalized = context ? normalizeContext(context) : undefined;
    if (this.pretty) {
      const suffix =
        normalized && Object.keys(normalized).length ? ` ${JSON.stringify(normalized)}` : '';
      stream.write(`[portqueue] ${level} ${message}${suffix}\n`);
    } else {
      stream.write(
        `${JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...normalized })}\n`,
      );
    }
  }
}

/** Serialize an Error in `err` to a plain object so it survives JSON logging. */
function normalizeContext(context: LogContext): Record<string, unknown> {
  const out: Record<string, unknown> = { ...context };
  if (out.err instanceof Error) {
    out.err = { name: out.err.name, message: out.err.message, stack: out.err.stack };
  }
  return out;
}

/** A logger that discards everything — handy for tests. */
export class NoopLogger implements Logger {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
}
