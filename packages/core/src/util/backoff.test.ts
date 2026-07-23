import { computeBackoffMs } from './backoff';
import { BackoffStrategy } from '../options/enums';

describe('computeBackoffMs', () => {
  it('returns the base delay for FIXED', () => {
    expect(
      computeBackoffMs({ strategy: BackoffStrategy.FIXED, attempt: 3, baseDelayMs: 500 }),
    ).toBe(500);
  });

  it('grows geometrically for EXPONENTIAL', () => {
    const base = { strategy: BackoffStrategy.EXPONENTIAL, baseDelayMs: 100, factor: 2 };
    expect(computeBackoffMs({ ...base, attempt: 1 })).toBe(100);
    expect(computeBackoffMs({ ...base, attempt: 2 })).toBe(200);
    expect(computeBackoffMs({ ...base, attempt: 3 })).toBe(400);
  });

  it('caps at maxDelayMs', () => {
    expect(
      computeBackoffMs({
        strategy: BackoffStrategy.EXPONENTIAL,
        attempt: 10,
        baseDelayMs: 100,
        factor: 2,
        maxDelayMs: 1000,
      }),
    ).toBe(1000);
  });

  it('applies full jitter with an injected random source', () => {
    const delay = computeBackoffMs({
      strategy: BackoffStrategy.FIXED,
      attempt: 1,
      baseDelayMs: 1000,
      jitter: true,
      random: () => 0.5,
    });
    expect(delay).toBe(500);
  });
});
