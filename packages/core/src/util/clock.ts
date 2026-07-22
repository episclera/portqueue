/**
 * An injectable clock so delay/cron/backoff/retention/visibility
 * logic is testable deterministically without real waiting.
 */
export interface Clock {
  now(): number;
  date(): Date;
}

/** The real system clock used in production. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  date(): Date {
    return new Date();
  }
}

/** A manually-advanced clock for tests. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: number | Date = 0) {
    this.current = start instanceof Date ? start.getTime() : start;
  }

  now(): number {
    return this.current;
  }

  date(): Date {
    return new Date(this.current);
  }

  /** Advance the clock by `ms` and return the new time. */
  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }

  /** Jump to an absolute time. */
  set(time: number | Date): void {
    this.current = time instanceof Date ? time.getTime() : time;
  }
}
