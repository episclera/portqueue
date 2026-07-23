import { toMs } from '../util/duration';
import type { Duration } from '../util/duration';
import type { Clock } from '../util/clock';

/**
 * A worker-local token-bucket limiter. Exact and in-process; limits how
 * many jobs this worker starts per window. Distinct from the cluster-wide queue rate limit.
 */
export class RateLimiterService {
  private tokens: number;
  private lastRefill: number;
  private readonly max: number;
  private readonly windowMs: number;

  constructor(
    options: { max: number; duration: Duration },
    private readonly clock: Clock,
  ) {
    this.max = options.max;
    this.windowMs = toMs(options.duration);
    this.tokens = options.max;
    this.lastRefill = clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const refill = (elapsed / this.windowMs) * this.max;
    this.tokens = Math.min(this.max, this.tokens + refill);
    this.lastRefill = now;
  }

  /** Consume up to `want` tokens; returns how many were granted. */
  take(want: number): number {
    this.refill();
    const grant = Math.max(0, Math.min(want, Math.floor(this.tokens)));
    this.tokens -= grant;
    return grant;
  }

  /** Milliseconds until at least one token is available (for loop backoff). */
  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const needed = 1 - this.tokens;
    return Math.ceil((needed / this.max) * this.windowMs);
  }
}
