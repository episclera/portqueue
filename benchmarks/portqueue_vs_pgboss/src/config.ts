/**
 * Benchmark sizes and the scenario catalogue. Every size can be overridden with an environment
 * variable so a quick smoke run (`BENCH_REPEATS=1 BENCH_PROCESS_JOBS=500 …`) and a full run use the
 * same code.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got '${raw}'.`);
  }
  return value;
}

export const config = {
  /** Fresh child processes per (library, scenario); the reported value is their median. */
  repeats: intFromEnv('BENCH_REPEATS', 3),
  /** Jobs added one `addJob` / `send` call at a time. */
  enqueueSingleJobs: intFromEnv('BENCH_ENQUEUE_SINGLE_JOBS', 2_000),
  /** Jobs added through the batch API, in chunks of `batchChunk`. */
  enqueueBatchJobs: intFromEnv('BENCH_ENQUEUE_BATCH_JOBS', 20_000),
  /** Rows per batch insert — PortQueue's `MAX_BATCH_IDS`, used for both libraries. */
  batchChunk: intFromEnv('BENCH_BATCH_CHUNK', 1_000),
  /** Jobs pre-seeded and then drained by a no-op handler. */
  processJobs: intFromEnv('BENCH_PROCESS_JOBS', 10_000),
  /** Jobs fetched per claim *and* in flight at once, for both libraries. */
  concurrency: intFromEnv('BENCH_CONCURRENCY', 100),
  /** Sequential add → handler-start round trips. */
  latencyJobs: intFromEnv('BENCH_LATENCY_JOBS', 50),
};

// `as const` objects rather than TS enums: Node runs these files with type stripping, which only
// erases syntax and cannot compile an enum.
export const Library = {
  PORTQUEUE: 'portqueue',
  PGBOSS: 'pg-boss',
} as const;
export type Library = (typeof Library)[keyof typeof Library];

export const Scenario = {
  ENQUEUE_SINGLE: 'enqueue-single',
  ENQUEUE_BATCH: 'enqueue-batch',
  PROCESS: 'process',
  LATENCY: 'latency',
} as const;
export type Scenario = (typeof Scenario)[keyof typeof Scenario];

export interface ScenarioMeta {
  key: Scenario;
  title: string;
  unit: string;
  higherIsBetter: boolean;
  /** One sentence for the README and docs: what was timed. */
  description: string;
}

export const SCENARIOS: ScenarioMeta[] = [
  {
    key: Scenario.ENQUEUE_SINGLE,
    title: 'Adding jobs, one at a time',
    unit: 'jobs/s',
    higherIsBetter: true,
    description: `${config.enqueueSingleJobs} sequential \`addJob\` / \`send\` calls, each awaited.`,
  },
  {
    key: Scenario.ENQUEUE_BATCH,
    title: 'Adding jobs in batches',
    unit: 'jobs/s',
    higherIsBetter: true,
    description:
      `${config.enqueueBatchJobs} jobs through \`addJobs\` / \`insert\`, ` +
      `${config.batchChunk} per call.`,
  },
  {
    key: Scenario.PROCESS,
    title: 'Processing jobs',
    unit: 'jobs/s',
    higherIsBetter: true,
    description:
      `${config.processJobs} pre-seeded jobs drained by a no-op handler, ` +
      `${config.concurrency} fetched per claim and in flight; timed until every job is settled.`,
  },
  {
    key: Scenario.LATENCY,
    title: 'Pickup latency (p50)',
    unit: 'ms',
    higherIsBetter: false,
    description:
      `${config.latencyJobs} sequential jobs on an idle worker, timed from the add call to the ` +
      `handler starting.`,
  },
];

/** The metric the repo README and the docs homepage chart, across every comparison. */
export const HEADLINE_SCENARIO = Scenario.PROCESS;

/**
 * The database driver every library ran on in this comparison. The summary charts group by it, so
 * bars are only ever compared against bars on the same driver.
 */
export const ENGINE = 'PGLite';

/** Every scenario's raw measurement, as one child process reports it. */
export interface Measurement {
  /** The value charted: jobs/s for throughput scenarios, milliseconds for latency. */
  value: number;
  /** Supporting numbers shown in the tables (p95, elapsed time, …). */
  extra: Record<string, number>;
}

export const QUEUE_NAME = 'bench';

/** How `measure.ts` marks its result line on stdout for `run.ts` to pick up. */
export const RESULT_PREFIX = 'RESULT ';
