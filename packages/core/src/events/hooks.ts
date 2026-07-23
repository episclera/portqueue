import type { AddJobOptions, JobOptions } from '../options/job-options';
import type { Job } from '../jobs/job';
import type { AddJobResult } from '../producer/results';

/** Hook lifecycle phases. */
export enum HookPhase {
  BEFORE_ADD = 'BEFORE_ADD',
  AFTER_ADD = 'AFTER_ADD',
  BEFORE_PROCESS = 'BEFORE_PROCESS',
  AFTER_PROCESS = 'AFTER_PROCESS',
}

/** Outcome descriptor passed to AFTER_PROCESS hooks. */
export type ProcessOutcome =
  | { kind: 'completed'; returnValue: unknown }
  | { kind: 'failed'; error: unknown }
  | { kind: 'retry'; error: unknown; nextRunAt: Date };

/** A modified add — a BEFORE_ADD hook may return this to mutate the outgoing job. */
export interface BeforeAddResult<TData = unknown> {
  options?: Partial<AddJobOptions<TData>>;
}

/**
 * Participation-hook registration. Hooks are awaited, run in
 * registration order, and can mutate BEFORE_ADD/BEFORE_PROCESS or veto by throwing.
 */
export interface HookRegistration {
  phase: HookPhase;
  /** Optional queue scope. */
  queue?: string;
  handler: HookHandler;
}

export type HookHandler =
  | ((ctx: {
      queue: string;
      options: AddJobOptions<unknown>;
    }) => Promise<BeforeAddResult | void> | BeforeAddResult | void)
  | ((ctx: { result: AddJobResult }) => Promise<void> | void)
  | ((ctx: { job: Job }) => Promise<void> | void)
  | ((ctx: { job: Job; outcome: ProcessOutcome }) => Promise<void> | void);

/** Convenience typed registration builders (all optional to use). */
export interface BeforeAddHook<TData = unknown> {
  phase: HookPhase.BEFORE_ADD;
  queue?: string;
  handler: (ctx: {
    queue: string;
    options: AddJobOptions<TData>;
  }) => Promise<BeforeAddResult<TData> | void> | BeforeAddResult<TData> | void;
}

export type { JobOptions };
