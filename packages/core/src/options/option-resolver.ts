import { BackoffStrategy, RetentionMode } from './enums';
import type { JobOptions } from './job-options';
import type { RetentionOptions } from './common';
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
 * Merges client → queue → job options (job wins) and freezes resolved values
 *. Resolution happens once, at insert time.
 */
export class OptionResolver {
  constructor(
    private readonly clientDefaults: JobOptions | undefined,
    private readonly clientRetention: RetentionOptions | undefined,
  ) {}

  resolve(options: {
    job: JobOptions;
    queueDefaults?: JobOptions;
    queueRetention?: RetentionOptions;
    now: number;
  }): ResolvedJobOptions {
    const { job, queueDefaults, queueRetention, now } = options;
    const merged: JobOptions = { ...this.clientDefaults, ...queueDefaults, ...job };

    const startAfter = this.resolveStartAfter(merged, now);
    const expireAt = merged.expireIn != null ? startAfter + toMs(merged.expireIn) : null;

    const backoff = merged.retryBackoff;
    const retention = merged.retention ?? queueRetention ?? this.clientRetention;

    return {
      priority: merged.priority ?? 0,
      startAfter,
      expireAt,
      retryMaxAttempts: merged.retryMaxAttempts ?? 1,
      retryDelayMs: merged.retryDelay != null ? toMs(merged.retryDelay) : 0,
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

  private resolveStartAfter(options: JobOptions, now: number): number {
    if (options.startAfter != null) {
      if (options.startAfter instanceof Date) return options.startAfter.getTime();
      return now + toMs(options.startAfter);
    }
    return now;
  }
}
