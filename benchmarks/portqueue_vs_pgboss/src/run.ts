/**
 * Run the whole comparison: every scenario for every library, `config.repeats` times each, every
 * run in a fresh child process. Writes the results and refreshes the README and docs charts.
 *
 *   node src/run.ts                       # everything
 *   node src/run.ts process latency       # only the named scenarios (results are merged)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, Library, RESULT_PREFIX, Scenario, SCENARIOS, type Measurement } from './config.ts';
import { writeReport, type LibraryResult } from './report.ts';
import { median, round } from './stats.ts';

const MEASURE = fileURLToPath(new URL('./measure.ts', import.meta.url));

function measureOnce(library: Library, scenario: Scenario): Promise<Measurement> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MEASURE, library, scenario], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      const line = out.split('\n').find((l) => l.startsWith(RESULT_PREFIX));
      if (code !== 0 || !line) {
        reject(new Error(`${library} / ${scenario} exited with code ${code}\n${out}`));
        return;
      }
      resolve(JSON.parse(line.slice(RESULT_PREFIX.length)) as Measurement);
    });
  });
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((s) => !SCENARIOS.some((m) => m.key === s));
  if (unknown.length) {
    throw new Error(
      `unknown scenario(s): ${unknown.join(', ')} — expected ${SCENARIOS.map((m) => m.key).join(', ')}`,
    );
  }
  const scenarios = requested.length
    ? SCENARIOS.filter((m) => requested.includes(m.key))
    : SCENARIOS;
  const results: Partial<Record<Scenario, LibraryResult[]>> = {};

  console.log(
    `PortQueue vs pg-boss — ${config.repeats} run(s) per measurement, in-memory PGLite\n`,
  );
  for (const meta of scenarios) {
    console.log(`▶ ${meta.title}`);
    const perLibrary: LibraryResult[] = [];
    for (const library of Object.values(Library)) {
      const runs: Measurement[] = [];
      for (let r = 0; r < config.repeats; r += 1) runs.push(await measureOnce(library, meta.key));
      // Report the run whose headline value is the median, with that run's own supporting numbers.
      const mid = median(runs.map((m) => m.value));
      const chosen = runs.find((m) => m.value === mid) ?? runs[0]!;
      perLibrary.push({ library, value: round(chosen.value), extra: chosen.extra });
      console.log(
        `  ${library.padEnd(10)} ${round(chosen.value).toLocaleString('en-US')} ${meta.unit}`,
      );
    }
    results[meta.key] = perLibrary;
    console.log('');
  }

  const written = await writeReport(results);
  console.log('Updated:');
  for (const path of written) console.log(`  ${path}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
