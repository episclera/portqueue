import { OptionResolver } from './option-resolver';
import { BackoffStrategy, RetentionMode } from './enums';

describe('OptionResolver precedence (queue < job)', () => {
  const now = 1_000_000;

  it('applies queue defaults, overridden by job', () => {
    const resolver = new OptionResolver();
    const resolved = resolver.resolve({
      job: { priority: 9 },
      queueDefaults: { priority: 5, retry: { maxAttempts: 3 } },
      now,
    });
    expect(resolved.priority).toBe(9); // job wins
    expect(resolved.retryMaxAttempts).toBe(3); // queue default applies when job omits it
  });

  it('resolves a relative startAfter Duration into a future start_after', () => {
    const resolver = new OptionResolver();
    expect(resolver.resolve({ job: {}, startAfter: 5000, now }).startAfter).toBe(now + 5000);
  });

  it('resolves an absolute startAfter Date', () => {
    const resolver = new OptionResolver();
    const at = new Date(now + 9999);
    expect(resolver.resolve({ job: {}, startAfter: at, now }).startAfter).toBe(at.getTime());
  });

  it('computes expireAt from expireIn relative to start_after', () => {
    const resolver = new OptionResolver();
    const r = resolver.resolve({ job: { expireIn: 2000 }, startAfter: 1000, now });
    expect(r.expireAt).toBe(now + 1000 + 2000);
  });

  it('resolves retention from job over queue', () => {
    const resolver = new OptionResolver();
    const r = resolver.resolve({
      job: { retention: { mode: RetentionMode.DELETE_AFTER, ttl: 3000 } },
      queueRetention: { mode: RetentionMode.KEEP_FOREVER },
      now,
    });
    expect(r.retentionMode).toBe(RetentionMode.DELETE_AFTER);
    expect(r.retentionTtlMs).toBe(3000);
  });

  it('carries backoff strategy/factor/cap/jitter', () => {
    const resolver = new OptionResolver();
    const r = resolver.resolve({
      job: {
        retry: {
          backoff: {
            strategy: BackoffStrategy.EXPONENTIAL,
            factor: 3,
            maxDelay: 10_000,
            jitter: true,
          },
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
