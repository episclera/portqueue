import { OptionResolver } from './option-resolver.js';
import { BackoffStrategy, RetentionMode } from './enums.js';

describe('OptionResolver precedence (client < queue < job)', () => {
  const now = 1_000_000;

  it('applies client defaults, overridden by queue, overridden by job', () => {
    const resolver = new OptionResolver({ priority: 1, retryMaxAttempts: 1 }, undefined);
    const resolved = resolver.resolve({
      job: { priority: 9 },
      queueDefaults: { priority: 5, retryMaxAttempts: 3 },
      now,
    });
    expect(resolved.priority).toBe(9); // job wins
    expect(resolved.retryMaxAttempts).toBe(3); // queue over client
  });

  it('resolves a relative startAfter Duration into a future start_after', () => {
    const resolver = new OptionResolver(undefined, undefined);
    expect(resolver.resolve({ job: { startAfter: 5000 }, now }).startAfter).toBe(now + 5000);
  });

  it('resolves an absolute startAfter Date', () => {
    const resolver = new OptionResolver(undefined, undefined);
    const at = new Date(now + 9999);
    expect(resolver.resolve({ job: { startAfter: at }, now }).startAfter).toBe(at.getTime());
  });

  it('computes expireAt from expireIn relative to start_after', () => {
    const resolver = new OptionResolver(undefined, undefined);
    const r = resolver.resolve({ job: { startAfter: 1000, expireIn: 2000 }, now });
    expect(r.expireAt).toBe(now + 1000 + 2000);
  });

  it('resolves retention from job over queue over client', () => {
    const resolver = new OptionResolver(undefined, { mode: RetentionMode.KEEP_FOREVER });
    const r = resolver.resolve({
      job: { retention: { mode: RetentionMode.DELETE_AFTER, ttl: 3000 } },
      queueRetention: { mode: RetentionMode.KEEP_FOREVER },
      now,
    });
    expect(r.retentionMode).toBe(RetentionMode.DELETE_AFTER);
    expect(r.retentionTtlMs).toBe(3000);
  });

  it('carries backoff strategy/factor/cap/jitter', () => {
    const resolver = new OptionResolver(undefined, undefined);
    const r = resolver.resolve({
      job: {
        retryBackoff: {
          strategy: BackoffStrategy.EXPONENTIAL,
          factor: 3,
          maxDelay: 10_000,
          jitter: true,
        },
      },
      now,
    });
    expect(r.retryBackoff).toBe(BackoffStrategy.EXPONENTIAL);
    expect(r.retryBackoffFactor).toBe(3);
    expect(r.retryMaxDelayMs).toBe(10_000);
    expect(r.retryJitter).toBe(true);
  });
});
