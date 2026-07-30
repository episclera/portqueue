import { OptionResolver } from './option-resolver';
import { BackoffStrategy } from './enums';

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

  it('resolves a relative startAfterSeconds into a future start_after', () => {
    const resolver = new OptionResolver();
    expect(resolver.resolve({ job: {}, startAfterSeconds: 5, now }).startAfter).toBe(now + 5000);
  });

  it('starts a job now when no delay is given', () => {
    const resolver = new OptionResolver();
    expect(resolver.resolve({ job: {}, now }).startAfter).toBe(now);
  });

  it('rejects a fractional delay — seconds are the smallest unit and are stored as integers', () => {
    const resolver = new OptionResolver();
    expect(() => resolver.resolve({ job: {}, startAfterSeconds: 0.25, now })).toThrow(
      /whole, non-negative number of seconds/,
    );
    expect(() => resolver.resolve({ job: { expireInSeconds: 1.5 }, now })).toThrow(
      /whole, non-negative number of seconds/,
    );
  });

  it('computes expireAt from expireInSeconds relative to start_after', () => {
    const resolver = new OptionResolver();
    const r = resolver.resolve({ job: { expireInSeconds: 2 }, startAfterSeconds: 1, now });
    expect(r.expireAt).toBe(now + 1000 + 2000);
  });

  it('resolves retention from job over queue', () => {
    const resolver = new OptionResolver();
    const r = resolver.resolve({
      job: { retention: { ttlSeconds: 3 } },
      queueRetention: { ttlSeconds: 600 },
      now,
    });
    expect(r.retentionTtlSeconds).toBe(3);
  });

  it('leaves the TTL null when neither the job nor the queue asked for retention', () => {
    // No retention at all is the only way to keep a job forever — there is no mode saying so.
    const resolver = new OptionResolver();
    const r = resolver.resolve({ job: {}, now });
    expect(r.retentionTtlSeconds).toBeNull();
    expect(r.retentionStatuses).toBeNull();
  });

  it('carries backoff strategy/factor/cap/jitter', () => {
    const resolver = new OptionResolver();
    const r = resolver.resolve({
      job: {
        retry: {
          backoff: {
            strategy: BackoffStrategy.EXPONENTIAL,
            factor: 3,
            maxDelaySeconds: 10,
            jitter: true,
          },
        },
      },
      now,
    });
    expect(r.retryBackoff).toBe(BackoffStrategy.EXPONENTIAL);
    expect(r.retryBackoffFactor).toBe(3);
    expect(r.retryMaxDelaySeconds).toBe(10);
    expect(r.retryJitter).toBe(true);
  });
});
