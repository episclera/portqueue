import { JobStatus } from '@portqueue/core';
import { flagString } from '../args.js';
import { CliError } from '../errors.js';
import type { Flags } from './types.js';

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
