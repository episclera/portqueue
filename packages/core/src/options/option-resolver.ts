import { BackoffStrategy, RetentionMode } from './enums';
import type { JobOptions } from './job-options';
import type { RetentionOptions } from './common';
import { assertSeconds, secondsToMs } from '../util/seconds';

/**
 * The fully-resolved per-job settings frozen onto a `job` row. Instants (`startAfter`, `expireAt`)
 * are epoch ms; every duration is seconds, exactly as the caller gave it.
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
  retentionMode: RetentionMode;
  retentionTtlSeconds: number | null;
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
    /** One-off start instant from the job's `schedule` group (not a mergeable default). */
    startAfter?: Date;
    /** One-off start delay in seconds from the job's `schedule` group. */
    startAfterSeconds?: number;
    now: number;
  }): ResolvedJobOptions {
    const { job, queueDefaults, queueRetention, now } = options;
    const merged: JobOptions = { ...queueDefaults, ...job };

    const startAfter = this.resolveStartAfter(options.startAfter, options.startAfterSeconds, now);
    const expireAt =
      merged.expireInSeconds != null
        ? startAfter + secondsToMs(merged.expireInSeconds, 'expireInSeconds')
        : null;

    const backoff = merged.retry?.backoff;
    const retention = merged.retention ?? queueRetention;

    return {
      priority: merged.priority ?? 0,
      startAfter,
      expireAt,
      retryMaxAttempts: merged.retry?.maxAttempts ?? 1,
      retryDelaySeconds:
        merged.retry?.delaySeconds != null
          ? assertSeconds(merged.retry.delaySeconds, 'retry.delaySeconds')
          : 0,
      retryBackoff: backoff?.strategy ?? BackoffStrategy.FIXED,
      retryBackoffFactor: backoff?.factor ?? null,
      retryMaxDelaySeconds:
        backoff?.maxDelaySeconds != null
          ? assertSeconds(backoff.maxDelaySeconds, 'retry.backoff.maxDelaySeconds')
          : null,
      retryJitter: backoff?.jitter ?? false,
      retentionMode: retention?.mode ?? RetentionMode.KEEP_FOREVER,
      retentionTtlSeconds:
        retention?.ttlSeconds != null
          ? assertSeconds(retention.ttlSeconds, 'retention.ttlSeconds')
          : null,
      idempotencyKey: merged.idempotencyKey ?? null,
      singletonKey: merged.singletonKey ?? null,
    };
  }

  private resolveStartAfter(
    startAfter: Date | undefined,
    startAfterSeconds: number | undefined,
    now: number,
  ): number {
    if (startAfter != null) return startAfter.getTime();
    if (startAfterSeconds != null) {
      return now + secondsToMs(startAfterSeconds, 'schedule.startAfterSeconds');
    }
    return now;
  }
}
