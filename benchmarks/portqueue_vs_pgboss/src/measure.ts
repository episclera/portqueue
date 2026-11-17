/**
 * One measurement in a fresh process: `node src/measure.ts <library> <scenario>`.
 *
 * `run.ts` spawns this once per (library, scenario, repeat) so no run inherits another's heap, JIT
 * warm-up or WASM memory. The result is printed as the last stdout line, prefixed `RESULT `.
 */
import { Library, RESULT_PREFIX, Scenario, type Measurement } from './config.ts';
import type { Contender } from './contender.ts';
import { SCENARIO_RUNNERS } from './scenarios.ts';

// Loaded lazily, so a run only imports the library it measures.
const CONTENDERS: Record<Library, () => Promise<Contender>> = {
  [Library.PORTQUEUE]: async () => (await import('./libs/portqueue.ts')).createPortQueueContender(),
  [Library.PGBOSS]: async () => (await import('./libs/pgboss.ts')).createPgBossContender(),
};

function isOneOf<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const [library, scenario] = process.argv.slice(2);
  if (!isOneOf(Object.values(Library), library) || !isOneOf(Object.values(Scenario), scenario)) {
    throw new Error(
      `usage: node src/measure.ts <${Object.values(Library).join('|')}> ` +
        `<${Object.values(Scenario).join('|')}>`,
    );
  }
  // Both libraries `unref` their poll timers, so while a scenario awaits a job nothing else would
  // keep the process alive and Node would exit mid-measurement with code 0.
  const keepAlive = setInterval(() => {}, 1_000);
  const contender = await CONTENDERS[library]();
  await contender.start();
  let result: Measurement;
  try {
    // Every run must start from a clean database; refuse to measure anything else.
    const leftover = await contender.countJobs();
    if (leftover !== 0) {
      throw new Error(`${library}: expected an empty database, found ${leftover} job(s).`);
    }
    result = await SCENARIO_RUNNERS[scenario](contender);
  } finally {
    await contender.stop();
    clearInterval(keepAlive);
  }
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
