import { performance } from 'node:perf_hooks';

export function median(values: number[]): number {
  return percentile(values, 50);
}

/** Nearest-rank percentile; `values` need not be sorted. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!;
}

/** Throughput of `jobs` finished in `elapsedMs`. */
export function jobsPerSecond(jobs: number, elapsedMs: number): number {
  return jobs / (elapsedMs / 1_000);
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export async function timed(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

/** Resolve once `check()` is true, polling every `everyMs`; reject after `timeoutMs`. */
export async function waitUntil(
  check: () => boolean | Promise<boolean>,
  { everyMs = 5, timeoutMs = 600_000 }: { everyMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
