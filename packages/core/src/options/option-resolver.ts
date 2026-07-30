import { BackoffStrategy } from './enums';
import type { JobOptions } from './job-options';
import type { RetentionOptions } from './common';
import type { JobStatus } from '../jobs/job-state.enum';
import { wholeSeconds, wholeSecondsToMs } from '../util/seconds';
import {
  DEFAULT_PRIORITY,
  DEFAULT_RETRY_DELAY_SECONDS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
} from '../constants';

/**
 * The fully-resolved per-job settings frozen onto a `job` row. Instants (`startAfter`, `expireAt`)
 * are epoch ms; every duration is a whole number of seconds, exactly as the
 * caller gave it.
 */
export interface ResolvedJobOptions {
  priority: number;
  startAfter: number;
  expireAt: number | null;
  retryMaxAttempts: number;
  retryDelaySeconds: number;
  retryBackoff: BackoffStrategy;
  retryBackoffFactor: number | null;
  retryMaxDelaySeconds: number | null;
  retryJitter: boolean;
  /** The TTL after finishing before this job is deleted, or null to keep it forever. */
  retentionTtlSeconds: number | null;
  /** The finished statuses retention may delete this job in, or null for every finished status. */
  retentionStatuses: JobStatus[] | null;
  idempotencyKey: string | null;
  singletonKey: string | null;
}

/**
 * Merges queue → job options (job wins) and freezes resolved values.
 * Resolution happens once, at insert time. There is no client-level default layer — job
 * defaults and retention are set per queue so nothing is silently inherited client-wide.
 */
export class OptionResolver {
  resolve(options: {
    job: JobOptions;
    queueDefaults?: JobOptions;
    queueRetention?: RetentionOptions;
    /** One-off start delay in seconds from the job's `schedule` group (not a mergeable default). */
    startAfterSeconds?: number;
    now: number;
  }): ResolvedJobOptions {
    const { job, queueDefaults, queueRetention, now } = options;
    const merged: JobOptions = { ...queueDefaults, ...job };

    const startAfter = this.resolveStartAfter(options.startAfterSeconds, now);
    const expireAt =
      merged.expireInSeconds != null
        ? startAfter + wholeSecondsToMs(merged.expireInSeconds, 'expireInSeconds')
        : null;

    const backoff = merged.retry?.backoff;
    // Retention is chosen whole, never merged field by field: a per-job policy replaces the
    // queue's rather than inheriting half of it.
    const retention = merged.retention ?? queueRetention;

    return {
      priority: merged.priority ?? DEFAULT_PRIORITY,
      startAfter,
      expireAt,
      retryMaxAttempts: merged.retry?.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
      retryDelaySeconds:
        merged.retry?.delaySeconds != null
          ? wholeSeconds(merged.retry.delaySeconds, 'retry.delaySeconds')
          : DEFAULT_RETRY_DELAY_SECONDS,
      retryBackoff: backoff?.strategy ?? BackoffStrategy.FIXED,
      retryBackoffFactor: backoff?.factor ?? null,
      retryMaxDelaySeconds:
        backoff?.maxDelaySeconds != null
          ? wholeSeconds(backoff.maxDelaySeconds, 'retry.backoff.maxDelaySeconds')
          : null,
      retryJitter: backoff?.jitter ?? false,
      retentionTtlSeconds:
        retention != null ? wholeSeconds(retention.ttlSeconds, 'retention.ttlSeconds') : null,
      // Null, not a defaulted list: "the caller didn't scope this" is a distinct state from "the
      // caller asked for exactly these", and the column stores null for the common case.
      retentionStatuses: retention?.statuses?.length ? [...retention.statuses] : null,
      idempotencyKey: merged.idempotencyKey ?? null,
      singletonKey: merged.singletonKey ?? null,
    };
  }

  private resolveStartAfter(startAfterSeconds: number | undefined, now: number): number {
    if (startAfterSeconds == null) return now;
    return now + wholeSecondsToMs(startAfterSeconds, 'schedule.startAfterSeconds');
  }
}
