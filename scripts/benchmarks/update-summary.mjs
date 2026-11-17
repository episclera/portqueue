#!/usr/bin/env node
/**
 * Rebuild the cross-comparison benchmark summary — the single bar chart on the repo README and the
 * docs homepage.
 *
 * Reads every comparison record in `docs/src/data/benchmarks/*.json` (each `benchmarks/<name>/`
 * package writes its own there), takes each record's headline scenario, and charts one bar for
 * PortQueue plus one bar per competitor. Adding a `benchmarks/portqueue_vs_<x>` comparison adds its
 * bar here with no change to this script. PortQueue's bar is taken from the most recent run, so
 * every bar should come from runs on the same machine — rerun all comparisons together when
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

const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json') && f !== 'summary.json');
const records = [];
for (const file of files) records.push(JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')));
const ran = records.filter((r) => r.runAt).sort((a, b) => b.runAt.localeCompare(a.runAt));

const barFor = (record, libraryKey) => {
  const scenario = record.scenarios.find((s) => s.key === record.headline);
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

const headline = ran[0]?.scenarios.find((s) => s.key === ran[0].headline) ?? null;
const bars = [];
if (ran.length) {
  const own = barFor(ran[0], PORTQUEUE);
  if (own) bars.push(own);
  for (const record of ran) {
    const competitor = barFor(record, record.competitor);
    if (competitor) bars.push(competitor);
  }
}

const summary = {
  runAt: ran[0]?.runAt ?? null,
  metric: headline
    ? {
        key: headline.key,
        title: headline.title,
        unit: headline.unit,
        higherIsBetter: headline.higherIsBetter,
        description: headline.description,
      }
    : null,
  environment: ran[0]?.environment ?? null,
  bars,
};
await writeFile(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);

const block = [];
if (!summary.metric || bars.length === 0) {
  block.push('_No benchmark results yet — run `npm run benchmark:portqueue-vs-pgboss`._');
} else {
  const better = summary.metric.higherIsBetter ? 'higher is better' : 'lower is better';
  const env = summary.environment;
  block.push(
    '```mermaid',
    'xychart-beta',
    `    title "${summary.metric.title} (${summary.metric.unit}, ${better})"`,
    `    x-axis [${bars.map((b) => `"${b.name}"`).join(', ')}]`,
    `    y-axis "${summary.metric.unit}"`,
    `    bar [${bars.map((b) => Math.round(b.value)).join(', ')}]`,
    '```',
    '',
    `${summary.metric.description} All libraries on in-memory PGLite; ` +
      `last run ${summary.runAt.slice(0, 10)}${env ? ` on ${env.cpu}, Node ${env.node}` : ''}. ` +
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
