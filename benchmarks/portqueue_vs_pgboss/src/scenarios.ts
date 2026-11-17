import { performance } from 'node:perf_hooks';
import { config, Scenario, type Measurement } from './config.ts';
import type { Contender, JobData } from './contender.ts';
import { jobsPerSecond, percentile, round, timed } from './stats.ts';

const noop = async (): Promise<void> => {};

function payloads(count: number): JobData[] {
  return Array.from({ length: count }, (_, i) => ({ i }));
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function enqueueSingle(c: Contender): Promise<Measurement> {
  const jobs = payloads(config.enqueueSingleJobs);
  const ms = await timed(async () => {
    for (const data of jobs) await c.add(data);
  });
  return {
    value: jobsPerSecond(jobs.length, ms),
    extra: { elapsedMs: round(ms), jobs: jobs.length },
  };
}

async function enqueueBatch(c: Contender): Promise<Measurement> {
  const batches = chunks(payloads(config.enqueueBatchJobs), config.batchChunk);
  const ms = await timed(async () => {
    for (const batch of batches) await c.addMany(batch);
  });
  return {
    value: jobsPerSecond(config.enqueueBatchJobs, ms),
    extra: { elapsedMs: round(ms), jobs: config.enqueueBatchJobs },
  };
}

async function processJobs(c: Contender): Promise<Measurement> {
  // Seeding is not timed: this scenario measures claiming, running and settling only.
  for (const batch of chunks(payloads(config.processJobs), config.batchChunk))
    await c.addMany(batch);
  const ms = await timed(async () => {
    await c.consume(noop, config.concurrency);
    await c.waitForCompleted(config.processJobs);
  });
  return {
    value: jobsPerSecond(config.processJobs, ms),
    extra: { elapsedMs: round(ms), jobs: config.processJobs, concurrency: config.concurrency },
  };
}

async function latency(c: Contender): Promise<Measurement> {
  let onStart: (() => void) | null = null;
  await c.consume(async () => {
    onStart?.();
  }, 1);

  const samples: number[] = [];
  for (const data of payloads(config.latencyJobs)) {
    const started = new Promise<void>((resolve) => {
      onStart = resolve;
    });
    const t0 = performance.now();
    await c.add(data);
    await started;
    samples.push(performance.now() - t0);
  }
  return {
    value: percentile(samples, 50),
    extra: {
      p50Ms: round(percentile(samples, 50)),
      p95Ms: round(percentile(samples, 95)),
      maxMs: round(Math.max(...samples)),
      jobs: samples.length,
    },
  };
}

export const SCENARIO_RUNNERS: Record<Scenario, (c: Contender) => Promise<Measurement>> = {
  [Scenario.ENQUEUE_SINGLE]: enqueueSingle,
  [Scenario.ENQUEUE_BATCH]: enqueueBatch,
  [Scenario.PROCESS]: processJobs,
  [Scenario.LATENCY]: latency,
};
