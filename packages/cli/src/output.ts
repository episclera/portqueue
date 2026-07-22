import { JobStatus } from '@portqueue/core';

const NO_COLOR = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;

type Ansi = keyof typeof CODES;
const CODES = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

let colorEnabled = !NO_COLOR;
export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function color(text: string, ...styles: Ansi[]): string {
  if (!colorEnabled) return text;
  return styles.map((s) => CODES[s]).join('') + text + CODES.reset;
}

/** Semantic color per job status, mirroring the dashboard StatusTag. */
export function colorStatus(status: JobStatus | string): string {
  switch (status) {
    case JobStatus.ACTIVE:
      return color(status, 'cyan');
    case JobStatus.COMPLETED:
      return color(status, 'green');
    case JobStatus.FAILED:
      return color(status, 'red');
    case JobStatus.RETRY:
      return color(status, 'yellow');
    case JobStatus.PENDING:
      return color(status, 'dim');
    default:
      return color(status, 'gray');
  }
}

export const symbols = {
  ok: () => color('✔', 'green'),
  warn: () => color('⚠', 'yellow'),
  err: () => color('✖', 'red'),
};

export function success(message: string): void {
  process.stdout.write(`${symbols.ok()} ${message}\n`);
}
export function warn(message: string): void {
  process.stdout.write(`${symbols.warn()} ${color(message, 'yellow')}\n`);
}
export function fail(message: string): void {
  process.stderr.write(`${symbols.err()} ${color(message, 'red')}\n`);
}
export function heading(text: string): void {
  process.stdout.write(`\n${color(text, 'bold')}\n`);
}

/** Render a simple aligned table. */
export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').replace(ANSI_RE, '').length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => {
        const visibleLen = c.replace(ANSI_RE, '').length;
        return c + ' '.repeat(Math.max(0, widths[i]! - visibleLen));
      })
      .join('  ');
  process.stdout.write(color(line(headers), 'dim') + '\n');
  for (const row of rows) process.stdout.write(line(row) + '\n');
}

// eslint-disable-next-line no-control-regex -- intentionally matches ANSI escape sequences to measure visible width
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Human-friendly relative time. */
export function relativeTime(date: Date | null | undefined, now = Date.now()): string {
  if (!date) return color('—', 'gray');
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const s = Math.round(abs / 1000);
  const unit =
    s < 60
      ? `${s}s`
      : s < 3600
        ? `${Math.round(s / 60)}m`
        : s < 86400
          ? `${Math.round(s / 3600)}h`
          : `${Math.round(s / 86400)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
