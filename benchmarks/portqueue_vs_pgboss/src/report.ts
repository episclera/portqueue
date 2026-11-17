/**
 * Turns a run into the three places results live:
 *
 * - `results/results.json` — the raw record, committed beside the benchmark;
 * - `docs/src/data/benchmarks/portqueue_vs_pgboss.json` — the same record, which the docs
 *   Benchmarks page charts;
 * - the block between the `benchmark-results` markers in this folder's README — Mermaid bar charts
 *   (GitHub renders them) and a table per scenario.
 *
 * The cross-comparison summary (repo README + docs homepage) is rebuilt afterwards by
 * `scripts/benchmarks/update-summary.mjs`, which reads every comparison's docs JSON.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ENGINE, HEADLINE_SCENARIO, Library, Scenario, SCENARIOS } from './config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(HERE, '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '../..');
const COMPARISON_ID = 'portqueue_vs_pgboss';

const RESULTS_FILE = join(PACKAGE_DIR, 'results/results.json');
const DOCS_DATA_FILE = join(REPO_ROOT, `docs/src/data/benchmarks/${COMPARISON_ID}.json`);
const README_FILE = join(PACKAGE_DIR, 'README.md');
const START = '<!-- benchmark-results:start -->';
const END = '<!-- benchmark-results:end -->';

const DISPLAY_NAME: Record<Library, string> = {
  [Library.PORTQUEUE]: 'PortQueue',
  [Library.PGBOSS]: 'pg-boss',
};
const PACKAGE_NAME: Record<Library, string> = {
  [Library.PORTQUEUE]: '@portqueue/core',
  [Library.PGBOSS]: 'pg-boss',
};

export interface LibraryResult {
  library: Library;
  value: number;
  extra: Record<string, number>;
}

export interface ComparisonRecord {
  id: string;
  title: string;
  /** The library PortQueue is compared with — the summary chart's bar for this comparison. */
  competitor: Library;
  /** The database driver both libraries ran on; the summary charts group by it. */
  engine: string;
  runAt: string | null;
  environment: Record<string, string | number> | null;
  libraries: Array<{ key: Library; name: string; package: string; version: string | null }>;
  headline: Scenario;
  scenarios: Array<{
    key: Scenario;
    title: string;
    unit: string;
    higherIsBetter: boolean;
    description: string;
    results: LibraryResult[];
  }>;
}

/** The installed version of `pkg`, found by walking up from its resolved entry point. */
async function packageVersion(pkg: string): Promise<string | null> {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(pkg)));
    while (dir !== dirname(dir)) {
      try {
        const json = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (json.name === pkg) return json.version ?? null;
      } catch {
        // no package.json at this level — keep walking
      }
      dir = dirname(dir);
    }
  } catch {
    // not resolvable
  }
  return null;
}

async function readExisting(): Promise<ComparisonRecord | null> {
  try {
    return JSON.parse(await readFile(RESULTS_FILE, 'utf8')) as ComparisonRecord;
  } catch {
    return null;
  }
}

export async function writeReport(
  results: Partial<Record<Scenario, LibraryResult[]>>,
): Promise<string[]> {
  const previous = await readExisting();
  const libraries = await Promise.all(
    Object.values(Library).map(async (key) => ({
      key,
      name: DISPLAY_NAME[key],
      package: PACKAGE_NAME[key],
      version: await packageVersion(PACKAGE_NAME[key]),
    })),
  );
  const cpu = cpus()[0]?.model.trim() ?? 'unknown';

  const record: ComparisonRecord = {
    id: COMPARISON_ID,
    title: 'PortQueue vs pg-boss',
    competitor: Library.PGBOSS,
    engine: ENGINE,
    runAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${platform()} ${arch()}`,
      cpu,
      cores: cpus().length,
      pglite: (await packageVersion('@electric-sql/pglite')) ?? 'unknown',
      repeats: config.repeats,
    },
    libraries,
    headline: HEADLINE_SCENARIO,
    scenarios: SCENARIOS.map((meta) => ({
      ...meta,
      // A partial run (`node src/run.ts process`) keeps the other scenarios' previous numbers.
      results:
        results[meta.key] ?? previous?.scenarios.find((s) => s.key === meta.key)?.results ?? [],
    })),
  };

  const json = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(RESULTS_FILE, json);
  await writeFile(DOCS_DATA_FILE, json);

  const readme = await readFile(README_FILE, 'utf8');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1)
    throw new Error(`README is missing the ${START} / ${END} markers`);
  await writeFile(
    README_FILE,
    `${readme.slice(0, start + START.length)}\n${renderMarkdown(record)}\n${readme.slice(end)}`,
  );

  return [RESULTS_FILE, DOCS_DATA_FILE, README_FILE].map((p) => relative(REPO_ROOT, p));
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function renderMarkdown(record: ComparisonRecord): string {
  const name = (key: Library) => record.libraries.find((l) => l.key === key)?.name ?? key;
  const env = record.environment;
  const lines: string[] = [];
  if (record.runAt && env) {
    lines.push(
      `_Last run ${record.runAt.slice(0, 10)} on ${env.cpu} (${env.cores} cores), ` +
        `${env.platform}, Node ${env.node}, PGLite ${env.pglite}; median of ${env.repeats} runs. ` +
        `Versions: ${record.libraries.map((l) => `${l.name} ${l.version ?? '?'}`).join(', ')}._`,
      '',
    );
  }
  for (const s of record.scenarios) {
    lines.push(`### ${s.title}`, '', s.description, '');
    if (s.results.length === 0) {
      lines.push('_Not run yet._', '');
      continue;
    }
    const better = s.higherIsBetter ? 'higher is better' : 'lower is better';
    lines.push(
      '```mermaid',
      'xychart-beta',
      `    title "${s.title} (${s.unit}, ${better})"`,
      `    x-axis [${s.results.map((r) => `"${name(r.library)} (${record.engine})"`).join(', ')}]`,
      `    y-axis "${s.unit}"`,
      `    bar [${s.results.map((r) => Math.round(r.value * 10) / 10).join(', ')}]`,
      '```',
      '',
    );
    const extraKeys = [...new Set(s.results.flatMap((r) => Object.keys(r.extra)))];
    lines.push(
      `| Library | ${s.unit} | ${extraKeys.join(' | ')} |`,
      `| --- | ---: | ${extraKeys.map(() => '---:').join(' | ')} |`,
      ...s.results.map(
        (r) =>
          `| ${name(r.library)} | **${formatNumber(r.value)}** | ` +
          `${extraKeys.map((k) => (r.extra[k] === undefined ? '' : formatNumber(r.extra[k]!))).join(' | ')} |`,
      ),
      '',
    );
  }
  return lines.join('\n');
}
