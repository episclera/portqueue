#!/usr/bin/env node
/**
 * Rebuild the cross-comparison benchmark summary: the bar charts on the repo README and the docs
 * homepage.
 *
 * Reads every comparison record in `docs/src/data/benchmarks/*.json` (each `benchmarks/<name>/`
 * package writes its own there) and draws **one chart per database driver and summary scenario**
 * (`record.engine` × `SUMMARY_SCENARIOS`), so a bar is only ever compared with bars on the same
 * driver. Each chart has one bar for PortQueue plus one per benchmarked library, at most
 * `MAX_COMPARISONS_PER_CHART` of them (newest runs first). Every label names its driver, e.g.
 * "pg-boss (PGLite)". Adding a `benchmarks/portqueue_vs_<x>` comparison adds its bar here with no
 * change to this script. PortQueue's bar in each chart comes from that driver's most recent run, so
 * every bar should come from runs on the same machine; rerun all comparisons together when
 * publishing.
 *
 * Writes `docs/src/data/benchmarks/summary.json` and the block between the `benchmarks-summary`
 * markers in the repo README.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = join(REPO_ROOT, 'docs/src/data/benchmarks');
const SUMMARY_FILE = join(DATA_DIR, 'summary.json');
const README_FILE = join(REPO_ROOT, 'README.md');
const START = '<!-- benchmarks-summary:start -->';
const END = '<!-- benchmarks-summary:end -->';
const PORTQUEUE = 'portqueue';
/** At most this many benchmarked libraries per driver chart (newest runs first), plus PortQueue. */
const MAX_COMPARISONS_PER_CHART = 5;
/**
 * The scenarios the summary charts, in order — three, so the docs homepage fills one row. Swap one
 * here to feature a different scenario. Every chart still compares PortQueue with every library
 * benchmarked on that driver.
 */
const SUMMARY_SCENARIOS = ['process', 'enqueue-batch', 'latency'];

const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json') && f !== 'summary.json');
const records = [];
for (const file of files) records.push(JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')));
const ran = records.filter((r) => r.runAt).sort((a, b) => b.runAt.localeCompare(a.runAt));

const barFor = (record, scenarioKey, libraryKey) => {
  const scenario = record.scenarios.find((s) => s.key === scenarioKey);
  const result = scenario?.results.find((r) => r.library === libraryKey);
  const library = record.libraries.find((l) => l.key === libraryKey);
  if (!scenario || !result || !library) return null;
  return {
    library: libraryKey,
    name: library.name,
    version: library.version,
    value: result.value,
    comparison: record.id,
  };
};

// For every driver, one chart per summary scenario: a bar is only ever compared with bars measured
// on the same driver in the same scenario.
const engines = [...new Set(ran.map((r) => r.engine))];
const charts = engines.flatMap((engine) => {
  const onEngine = ran.filter((r) => r.engine === engine);
  const shown = onEngine.slice(0, MAX_COMPARISONS_PER_CHART);
  return SUMMARY_SCENARIOS.flatMap((key) => {
    const meta = onEngine[0].scenarios.find((s) => s.key === key);
    if (!meta) return [];
    const bars = [
      barFor(onEngine[0], key, PORTQUEUE),
      ...shown.map((r) => barFor(r, key, r.competitor)),
    ].filter(Boolean);
    if (bars.length === 0) return [];
    return [
      {
        engine,
        scenario: key,
        title: meta.title,
        unit: meta.unit,
        higherIsBetter: meta.higherIsBetter,
        description: meta.description,
        bars,
      },
    ];
  });
});

const summary = {
  runAt: ran[0]?.runAt ?? null,
  environment: ran[0]?.environment ?? null,
  charts,
};
await writeFile(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);

const block = [];
if (charts.length === 0) {
  block.push('_No benchmark results yet — run `npm run benchmark:portqueue-vs-pgboss`._');
} else {
  const env = summary.environment;
  for (const chart of charts) {
    const better = chart.higherIsBetter ? 'higher is better' : 'lower is better';
    block.push(
      '```mermaid',
      'xychart-beta',
      `    title "${chart.title} on ${chart.engine} (${chart.unit}, ${better})"`,
      `    x-axis [${chart.bars.map((b) => `"${b.name} (${chart.engine})"`).join(', ')}]`,
      `    y-axis "${chart.unit}"`,
      `    bar [${chart.bars.map((b) => Math.round(b.value * 10) / 10).join(', ')}]`,
      '```',
      '',
    );
  }
  block.push(
    `Last run ${summary.runAt.slice(0, 10)}${env ? ` on ${env.cpu}, Node ${env.node}` : ''}. ` +
      'Every scenario and how it is measured: ' +
      '[Benchmarks](https://episclera.github.io/portqueue/docs/benchmarks).',
  );
}

const readme = await readFile(README_FILE, 'utf8');
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1)
  throw new Error(`README.md is missing the ${START} / ${END} markers`);
await writeFile(
  README_FILE,
  `${readme.slice(0, start + START.length)}\n${block.join('\n')}\n${readme.slice(end)}`,
);
console.log('Updated docs/src/data/benchmarks/summary.json and the README benchmarks section.');
