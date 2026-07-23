import { InvalidOptionsError } from '../errors/errors';

/**
 * A duration expressed either as milliseconds (number) or a human string
 * like `'30s'`, `'5m'`, `'1h'`, `'2d'`, `'500ms'`.
 */
export type Duration = number | string;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;

/** Resolve a {@link Duration} to milliseconds. Throws a clear error on a bad string. */
export function toMs(duration: Duration): number {
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new InvalidOptionsError(
        `Invalid duration ${duration}: a numeric duration must be a non-negative, finite number of milliseconds.`,
      );
    }
    return Math.round(duration);
  }
  const match = DURATION_RE.exec(duration.trim());
  if (!match) {
    throw new InvalidOptionsError(
      `Invalid duration '${duration}'. Use a number of milliseconds or a string like '30s', '5m', '1h', '2d', '500ms'.`,
    );
  }
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  return Math.round(value * UNIT_MS[unit]!);
}

/** Public helper mirroring `toMs`, exported for consumers who want the string form. */
export function duration(value: Duration): number {
  return toMs(value);
}
