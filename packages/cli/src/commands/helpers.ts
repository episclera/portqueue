import { JobStatus } from '@portqueue/core';
import { flagNumber, flagString } from '../args';
import { CliError } from '../errors';
import { color } from '../output';
import type { Flags } from './types';

/** Read a required string flag, or throw an actionable error naming it. */
export function requireFlag(flags: Flags, name: string): string {
  const value = flagString(flags, name);
  if (!value) throw new CliError(`Missing required --${name}.`);
  return value;
}

/** Parse a `--status` flag into a `JobStatus`, validating against the enum. */
export function parseStatus(value: string | undefined): JobStatus | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if ((Object.values(JobStatus) as string[]).includes(upper)) return upper as JobStatus;
  throw new CliError(`Unknown status '${value}'. Valid: ${Object.values(JobStatus).join(', ')}.`);
}

/** The paging window a list command was asked for, in the shape every public query takes. */
export interface PageFlags {
  limit?: number;
  offset?: number;
}

/**
 * Parse `--limit` / `--offset`.
 *
 * Tested with `!== undefined` rather than truthiness, which is what made `--limit 0` silently mean
 * "unset" and page the default 50 rows. A zero or negative limit is a mistake, so it says so.
 */
export function pageFlags(flags: Flags): PageFlags {
  const limit = flagNumber(flags, 'limit');
  const offset = flagNumber(flags, 'offset');
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new CliError(`--limit must be a whole number of at least 1 (got '${String(limit)}').`);
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new CliError(`--offset must be a whole number of at least 0 (got '${String(offset)}').`);
  }
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}

/**
 * Print the "there is more" hint after a page, if there is.
 *
 * Shared by every paged list so all of them say it the same way — `schedules` used to say nothing at
 * all, which made a deployment with more than one page of schedules look like it had one.
 */
export function printMoreHint(page: { items: unknown[]; total: number }, offset = 0): void {
  // The page carries no "hasMore" flag — the next offset is past the end or it isn't.
  const next = offset + page.items.length;
  if (next < page.total) {
    process.stdout.write(color(`\n… more — use --offset ${next}\n`, 'dim'));
  }
}

/** The `[--limit <n> --offset <n>]` fragment every paged command shows in help. */
export const PAGE_USAGE = '[--limit <n> --offset <n>]';
