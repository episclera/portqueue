import { CronExpressionParser } from 'cron-parser';
import { InvalidOptionsError } from '../errors/errors';

/**
 * A thin wrapper over the `cron-parser` package — the parsing and the calendar walk are its job,
 * not ours. What this class adds is the two things core depends on:
 *  - **eager validation** with a PortQueue-shaped `InvalidOptionsError`, so a bad expression fails
 *    at `addJob` rather than silently at the first tick;
 *  - a **plain epoch-ms `next()`**, so the scheduler never handles a library date type.
 *
 * Supported syntax is whatever `cron-parser` supports: 5-field
 * (minute hour day-of-month month day-of-week), an optional leading seconds field (6-field), plus
 * ranges, lists, steps, names (`MON`, `JAN`), and the specials `L`, `#`, `W`, `?`.
 *
 * `next-run` is computed in the schedule's IANA timezone (default UTC) and is DST-correct.
 *
 * Catch-up on restart: recurrences are **fire-once, no backfill**. If the process was down across
 * one or more due slots, on restart the schedule fires a single time and then advances to the next
 * future slot — every intermediate missed occurrence is skipped, not replayed. (See
 * `SchedulerService.fire`.)
 */
export class CronExpression {
  constructor(
    readonly expression: string,
    readonly timezone: string = 'UTC',
  ) {
    // Validate the timezone before the expression so an unknown zone gets its own clear message.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new InvalidOptionsError(
        `Invalid timezone '${timezone}' for cron expression '${expression}'.`,
      );
    }
    // Parse once up front so a malformed expression is rejected at add time.
    this.parse(0);
  }

  /** The next fire time strictly after `fromMs` (epoch ms). */
  next(fromMs: number): number {
    try {
      return this.parse(fromMs).next().getTime();
    } catch (err) {
      throw new InvalidOptionsError(
        `Cron expression '${this.expression}' has no upcoming run (possibly an impossible date): ${messageOf(err)}`,
      );
    }
  }

  private parse(fromMs: number): ReturnType<typeof CronExpressionParser.parse> {
    try {
      return CronExpressionParser.parse(this.expression, {
        currentDate: new Date(fromMs),
        tz: this.timezone,
      });
    } catch (err) {
      throw new InvalidOptionsError(
        `Invalid cron expression '${this.expression}': ${messageOf(err)}. ` +
          `Expected 5 fields (minute hour day-of-month month day-of-week), ` +
          `or 6 with a leading seconds field.`,
      );
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
