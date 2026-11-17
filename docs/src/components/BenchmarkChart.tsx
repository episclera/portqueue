import React from 'react';
import styles from './BenchmarkChart.module.css';

/**
 * Benchmark charts for the docs, drawn with plain CSS against the shared `--pq-*` tokens — no
 * charting dependency. The data is the JSON the benchmark runners write under
 * `docs/src/data/benchmarks/`, so a run updates every chart with no edit here.
 */

export interface Bar {
  label: string;
  sublabel?: string | null;
  value: number;
  highlight?: boolean;
}

export function BarChart({
  title,
  unit,
  higherIsBetter,
  bars,
}: {
  title: string;
  unit: string;
  higherIsBetter: boolean;
  bars: Bar[];
}): React.ReactElement {
  const max = Math.max(...bars.map((b) => b.value), 0);
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.title}>
        {title}{' '}
        <span className={styles.hint}>
          ({unit}, {higherIsBetter ? 'higher' : 'lower'} is better)
        </span>
      </figcaption>
      {bars.length === 0 ? (
        <p className={styles.empty}>Not run yet.</p>
      ) : (
        <div className={styles.rows}>
          {bars.map((bar) => (
            <div key={bar.label} className={styles.row}>
              <div className={styles.label}>
                {bar.label}
                {bar.sublabel ? <span className={styles.sublabel}>{bar.sublabel}</span> : null}
              </div>
              <div className={styles.track}>
                <div
                  className={bar.highlight ? styles.barHighlight : styles.bar}
                  style={{ width: `${max > 0 ? Math.max((bar.value / max) * 100, 1) : 0}%` }}
                />
                <span className={styles.value}>
                  {bar.value.toLocaleString('en-US', { maximumFractionDigits: 1 })} {unit}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

interface LibraryResult {
  library: string;
  value: number;
  extra: Record<string, number>;
}
export interface ComparisonRecord {
  id: string;
  title: string;
  runAt: string | null;
  environment: Record<string, string | number> | null;
  libraries: Array<{ key: string; name: string; version: string | null }>;
  scenarios: Array<{
    key: string;
    title: string;
    unit: string;
    higherIsBetter: boolean;
    description: string;
    results: LibraryResult[];
  }>;
}

/** The "last run" line: date, machine and versions. */
export function RunInfo({ record }: { record: ComparisonRecord }): React.ReactElement {
  const env = record.environment;
  if (!record.runAt || !env) {
    return <p className={styles.meta}>Not run yet. Results appear here after the first run.</p>;
  }
  return (
    <p className={styles.meta}>
      Last run {record.runAt.slice(0, 10)} on {env.cpu} ({env.cores} cores), {env.platform}, Node{' '}
      {env.node}, PGLite {env.pglite}. Median of {env.repeats} runs. Versions:{' '}
      {record.libraries.map((l) => `${l.name} ${l.version ?? '?'}`).join(', ')}.
    </p>
  );
}

/** Every scenario of one comparison, one bar chart each. */
export function ComparisonCharts({ record }: { record: ComparisonRecord }): React.ReactElement {
  const library = (key: string) => record.libraries.find((l) => l.key === key);
  return (
    <div>
      <RunInfo record={record} />
      {record.scenarios.map((s) => (
        <div key={s.key}>
          <BarChart
            title={s.title}
            unit={s.unit}
            higherIsBetter={s.higherIsBetter}
            bars={s.results.map((r) => ({
              label: library(r.library)?.name ?? r.library,
              sublabel: library(r.library)?.version,
              value: r.value,
              highlight: r.library === 'portqueue',
            }))}
          />
          <p className={styles.description}>{s.description}</p>
        </div>
      ))}
    </div>
  );
}

export interface BenchmarkSummary {
  runAt: string | null;
  metric: { title: string; unit: string; higherIsBetter: boolean; description: string } | null;
  bars: Array<{ library: string; name: string; version: string | null; value: number }>;
}

/** The single cross-comparison chart: PortQueue plus one bar per benchmarked library. */
export function SummaryChart({ summary }: { summary: BenchmarkSummary }): React.ReactElement {
  if (!summary.metric) {
    return <p className={styles.empty}>Benchmarks have not been run yet.</p>;
  }
  return (
    <BarChart
      title={summary.metric.title}
      unit={summary.metric.unit}
      higherIsBetter={summary.metric.higherIsBetter}
      bars={summary.bars.map((b) => ({
        label: b.name,
        sublabel: b.version,
        value: b.value,
        highlight: b.library === 'portqueue',
      }))}
    />
  );
}
