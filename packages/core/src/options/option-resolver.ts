import { BackoffStrategy, RetentionMode } from './enums';
import type { JobOptions } from './job-options';
import type { RetentionOptions } from './common';
import type { Duration } from '../util/duration';
import { toMs } from '../util/duration';

/** The fully-resolved per-job settings frozen onto a `job` row. */
export interface ResolvedJobOptions {
  priority: number;
  startAfter: number;
  expireAt: number | null;
  retryMaxAttempts: number;
  retryDelayMs: number;
  retryBackoff: BackoffStrategy;
  retryBackoffFactor: number | null;
  retryMaxDelayMs: number | null;
  retryJitter: boolean;
  retentionMode: RetentionMode;
  retentionTtlMs: number | null;
  idempotencyKey: string | null;
  singletonKey: string | null;
  metadata: Record<string, unknown>;
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
    /** One-off start delay from the job's `schedule` group (not a mergeable default). */
    startAfter?: Date | Duration;
    now: number;
  }): ResolvedJobOptions {
    const { job, queueDefaults, queueRetention, now } = options;
    const merged: JobOptions = { ...queueDefaults, ...job };

    const startAfter = this.resolveStartAfter(options.startAfter, now);
    const expireAt = merged.expireIn != null ? startAfter + toMs(merged.expireIn) : null;

    const backoff = merged.retry?.backoff;
    const retention = merged.retention ?? queueRetention;

    return {
      priority: merged.priority ?? 0,
      startAfter,
      expireAt,
      retryMaxAttempts: merged.retry?.maxAttempts ?? 1,
      retryDelayMs: merged.retry?.delay != null ? toMs(merged.retry.delay) : 0,
      retryBackoff: backoff?.strategy ?? BackoffStrategy.FIXED,
      retryBackoffFactor: backoff?.factor ?? null,
      retryMaxDelayMs: backoff?.maxDelay != null ? toMs(backoff.maxDelay) : null,
      retryJitter: backoff?.jitter ?? false,
      retentionMode: retention?.mode ?? RetentionMode.KEEP_FOREVER,
      retentionTtlMs: retention?.ttl != null ? toMs(retention.ttl) : null,
      idempotencyKey: merged.idempotencyKey ?? null,
      singletonKey: merged.singletonKey ?? null,
      metadata: merged.metadata ?? {},
    };
  }

  private resolveStartAfter(startAfter: Date | Duration | undefined, now: number): number {
    if (startAfter != null) {
      if (startAfter instanceof Date) return startAfter.getTime();
      return now + toMs(startAfter);
    }
    return now;
  }
}
