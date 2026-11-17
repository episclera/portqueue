import type { ComponentType, ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import clsx from 'clsx';
import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { TeamGrid } from '@site/src/components/TeamGrid';
import { SummaryCharts } from '@site/src/components/BenchmarkChart';
import benchmarkSummary from '@site/src/data/benchmarks/summary.json';
import styles from './index.module.css';

/**
 * The docs site imports `@ant-design/icons` directly; it shares design tokens with the dashboard
 * (`@portqueue/theme`), not components or the dashboard's curated `icons.ts` list.
 */
const FEATURES: {
  icon: ComponentType;
  title: string;
  body: ReactNode;
  to: string;
  cta: string;
}[] = [
  {
    icon: GlobalOutlined,
    title: 'Scales to Many Servers',
    body: (
      <>
        Scaling is just running more copies of your app — no leader election, no config, no
        coordinator.
        <br />
        Jobs can also target specific servers in your fleet for data locality.
      </>
    ),
    to: '/docs/scale-horizontally',
    cta: 'How it scales',
  },
  {
    icon: DashboardOutlined,
    title: 'A Powerful Dashboard & CLI',
    body: 'A mountable React dashboard (plus a full CLI) to monitor and control both queues and instances live — pause, resume, retry, and watch throughput, with no third-party service.',
    to: '/docs/dashboard',
    cta: 'See the dashboard',
  },
  {
    icon: DatabaseOutlined,
    title: 'Database Agnostic',
    body: (
      <>
        Point it at the database you already run — <strong>PostgreSQL</strong>,{' '}
        <strong>MySQL</strong>, <strong>Oracle</strong>, <strong>PGLite</strong>, or{' '}
        <strong>SQLite</strong>. Each driver picks the best strategy its engine supports, so your
        app code stays identical.
      </>
    ),
    to: '/docs/getting-started',
    cta: 'Pick a driver',
  },
  {
    icon: ThunderboltOutlined,
    title: 'Fast by Design',
    body: 'Tens of thousands of jobs per second: batched claims and settles, one statement per batch, and indexes shaped to the hot queries. Benchmarked head-to-head against other queues, with every run published.',
    to: '/docs/benchmarks',
    cta: 'See the benchmarks',
  },
  {
    icon: ClockCircleOutlined,
    title: 'Scheduling & Cron',
    body: 'Delayed jobs, fixed intervals, and cron with timezones — all through one addJob method.',
    to: '/docs/guides/scheduling',
    cta: 'Schedule jobs',
  },
  {
    icon: SafetyCertificateOutlined,
    title: 'Fault-Tolerant & Observable',
    body: 'Automatic retries with backoff, stalled-job reclaim, liveness-aware fallback, and at-least-once delivery — with rich events and hooks for metrics and tracing.',
    to: '/docs/events-hooks/events',
    cta: 'Events & hooks',
  },
];

const QUICK_START = `import { PortQueue } from '@portqueue/core';
import { PostgresqlDriver } from '@portqueue/core/drivers/postgresql';

enum QueueName { Emails = 'emails' }

const pq = new PortQueue<QueueName>({
  driver: new PostgresqlDriver({ connectionString: process.env.DATABASE_URL }),
});
await pq.init();

// Create the queue and provide a jobs handler.
pq.createQueue<{ to: string }>({
  name: QueueName.Emails,
  limiter: { concurrency: 10 },
  handler: async (job) => { await send(job.data); },
});

// Add a job to the queue.
await pq.addJob({ queue: QueueName.Emails, data: { to: 'a@b.com' } });`;

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  // Keyword-rich meta description for the highest-traffic page (SEO landing page).
  const description =
    'PortQueue is a broker-less, strictly typed background job queue for Node.js & TypeScript — ' +
    'delayed & cron jobs, retries, retention, and rate limiting on PostgreSQL, PGLite, SQLite, Oracle, or MySQL.';
  return (
    <Layout title="PortQueue" description={description}>
      <header className={styles.hero}>
        <div className={styles.heroBrand}>
          <img className={styles.heroLogo} src="/portqueue/img/logo.svg" alt="PortQueue logo" />
          <h1 className={styles.heroTitle}>PortQueue</h1>
        </div>
        <p className={styles.heroTagline}>{siteConfig.tagline}</p>
        <div className={styles.ctas}>
          <Link className={clsx(styles.cta, styles.ctaPrimary)} to="/docs/getting-started">
            Get Started
          </Link>
          <Link
            className={clsx(styles.cta, styles.ctaSecondary)}
            to="https://github.com/episclera/portqueue"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Link>
        </div>
      </header>

      <main>
        <section className={clsx(styles.section, styles.sectionTight)}>
          <div className={styles.featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden>
                  <f.icon />
                </span>
                <div className={styles.featureTitle}>{f.title}</div>
                <p className={styles.featureBody}>{f.body}</p>
                <Link className={styles.featureLink} to={f.to}>
                  {f.cta} <ArrowRightOutlined aria-hidden />
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>At a glance</h2>
          <p className={styles.sectionLead}>
            Add a job, process it on a worker. Same code on any driver.
          </p>
          <CodeBlock language="ts" title="app.ts">
            {QUICK_START}
          </CodeBlock>
        </section>

        <section id="benchmarks" className={styles.section}>
          <h2 className={styles.sectionTitle}>Benchmarks</h2>
          <p className={styles.sectionLead}>
            How PortQueue compares with other Node.js job queues. Each chart compares libraries on
            the same database driver. See <Link to="/docs/benchmarks">Benchmarks</Link> for every
            scenario and how it is measured.
          </p>
          <div className={styles.benchmarkChart}>
            <SummaryCharts summary={benchmarkSummary} />
          </div>
        </section>

        <section id="license" className={styles.section}>
          <h2 className={styles.sectionTitle}>License</h2>
          <p className={styles.sectionLead}>
            PortQueue is <strong>absolutely free</strong> — open source under the MIT license.
            Commercial use permitted, no license fee, no obligations. Use it in anything, forever.
          </p>
        </section>

        <section id="team" className={styles.section}>
          <h2 className={styles.sectionTitle}>Team</h2>
          <p className={styles.sectionLead}>The people who build PortQueue.</p>
          <TeamGrid centered />
          <p className={styles.sectionLead}>
            Want to join them? PortQueue is open source and welcomes contributors — see the{' '}
            <Link to="/docs/contributing">Contributing</Link> guide.
          </p>
        </section>
      </main>
    </Layout>
  );
}
