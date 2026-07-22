import { InvalidOptionsError } from '../errors/errors.js';

/**
 * A small, dependency-free cron parser (build_plan/06.7). Supports:
 *  - 5-field: minute hour day-of-month month day-of-week
 *  - optional leading seconds field (6-field)
 *  - ranges (`1-5`), lists (`1,3,5`), steps (`* /10`), and `*`
 * The specials `L` `#` `W` `?` are intentionally out of scope for v1 and throw a clear error.
 *
 * `next-run` is computed in the schedule's IANA timezone (default UTC), DST-correct because
 * each candidate instant is evaluated against the timezone's wall-clock fields via `Intl`.
 */
export class CronExpression {
  private readonly seconds: number[];
  private readonly minutes: number[];
  private readonly hours: number[];
  private readonly daysOfMonth: number[];
  private readonly months: number[];
  private readonly daysOfWeek: number[];
  private readonly domRestricted: boolean;
  private readonly dowRestricted: boolean;

  constructor(
    readonly expression: string,
    readonly timezone: string = 'UTC',
  ) {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5 && fields.length !== 6) {
      throw new InvalidOptionsError(
        `Invalid cron expression '${expression}': expected 5 fields (or 6 with a leading seconds field), got ${fields.length}.`,
      );
    }
    for (const token of fields) {
      if (/[L#W?]/i.test(token)) {
        const bad = token.match(/[L#W?]/i)?.[0];
        throw new InvalidOptionsError(
          `Cron expression '${expression}' uses the unsupported token '${bad}'. ` +
            `PortQueue v1 supports '*', ranges (1-5), lists (1,3,5), and steps (*/10) only.`,
        );
      }
    }
    const hasSeconds = fields.length === 6;
    const [sec, min, hour, dom, mon, dow] = hasSeconds
      ? (fields as [string, string, string, string, string, string])
      : (['0', ...fields] as [string, string, string, string, string, string]);

    this.seconds = parseField(sec, 0, 59, expression);
    this.minutes = parseField(min, 0, 59, expression);
    this.hours = parseField(hour, 0, 23, expression);
    this.daysOfMonth = parseField(dom, 1, 31, expression);
    this.months = parseField(mon, 1, 12, expression);
    this.daysOfWeek = parseField(dow, 0, 7, expression).map((d) => (d === 7 ? 0 : d));
    this.domRestricted = dom.trim() !== '*';
    this.dowRestricted = dow.trim() !== '*';

    // Validate the timezone eagerly with a clear error.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new InvalidOptionsError(
        `Invalid timezone '${timezone}' for cron expression '${expression}'.`,
      );
    }
  }

  /** The next fire time strictly after `fromMs` (epoch ms). */
  next(fromMs: number): number {
    let cursor = Math.floor(fromMs / 1000) * 1000 + 1000; // next whole second, strictly after
    // ~8 years of minute steps is a generous upper bound; a valid expression resolves far sooner.
    const maxIter = 8 * 366 * 24 * 60;
    for (let i = 0; i < maxIter; i++) {
      const parts = this.tzParts(cursor);
      if (this.matchesCalendar(parts)) {
        const sec = this.seconds.find((s) => s >= parts.second);
        if (sec !== undefined) {
          return cursor + (sec - parts.second) * 1000;
        }
      }
      // Jump to second 0 of the next minute (tz offsets are whole minutes, so UTC seconds align).
      cursor += (60 - parts.second) * 1000;
    }
    throw new InvalidOptionsError(
      `Cron expression '${this.expression}' has no upcoming run within the search window (possibly an impossible date).`,
    );
  }

  private matchesCalendar(p: CronParts): boolean {
    if (!this.minutes.includes(p.minute)) return false;
    if (!this.hours.includes(p.hour)) return false;
    if (!this.months.includes(p.month)) return false;
    // Standard cron: when both DOM and DOW are restricted, a match on *either* fires.
    const domOk = this.daysOfMonth.includes(p.day);
    const dowOk = this.daysOfWeek.includes(p.weekday);
    if (this.domRestricted && this.dowRestricted) return domOk || dowOk;
    if (this.domRestricted) return domOk;
    if (this.dowRestricted) return dowOk;
    return true;
  }

  /** Wall-clock fields of `ms` in this expression's timezone. */
  private tzParts(ms: number): CronParts {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts: Record<string, string> = {};
    for (const part of fmt.formatToParts(new Date(ms))) {
      if (part.type !== 'literal') parts[part.type] = part.value;
    }
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return {
      year,
      month,
      day,
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute),
      second: Number(parts.second),
      weekday,
    };
  }
}

interface CronParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function parseField(field: string, min: number, max: number, expression: string): number[] {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    let range = part;
    let step = 1;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      range = part.slice(0, slash);
      step = Number(part.slice(slash + 1));
      if (!Number.isInteger(step) || step <= 0) {
        throw new InvalidOptionsError(`Invalid step '${part}' in cron expression '${expression}'.`);
      }
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new InvalidOptionsError(
        `Invalid cron field '${part}' in '${expression}': values must be integers within ${min}-${max}.`,
      );
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}
