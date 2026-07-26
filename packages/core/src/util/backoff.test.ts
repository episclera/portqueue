import { computeBackoffSeconds } from './backoff';
import { BackoffStrategy } from '../options/enums';

describe('computeBackoffSeconds', () => {
  it('returns the base delay for FIXED', () => {
    expect(
      computeBackoffSeconds({ strategy: BackoffStrategy.FIXED, attempt: 3, baseDelaySeconds: 500 }),
    ).toBe(500);
  });

  it('grows geometrically for EXPONENTIAL', () => {
    const base = { strategy: BackoffStrategy.EXPONENTIAL, baseDelaySeconds: 100, factor: 2 };
    expect(computeBackoffSeconds({ ...base, attempt: 1 })).toBe(100);
    expect(computeBackoffSeconds({ ...base, attempt: 2 })).toBe(200);
    expect(computeBackoffSeconds({ ...base, attempt: 3 })).toBe(400);
  });

  it('caps at maxDelaySeconds', () => {
    expect(
      computeBackoffSeconds({
        strategy: BackoffStrategy.EXPONENTIAL,
        attempt: 10,
        baseDelaySeconds: 100,
        factor: 2,
        maxDelaySeconds: 1000,
      }),
    ).toBe(1000);
  });

  it('applies full jitter with an injected random source', () => {
    const delay = computeBackoffSeconds({
      strategy: BackoffStrategy.FIXED,
      attempt: 1,
      baseDelaySeconds: 1000,
      jitter: true,
      random: () => 0.5,
    });
    expect(delay).toBe(500);
  });
});
