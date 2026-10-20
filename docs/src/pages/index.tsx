import type { ComponentType, ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import clsx from 'clsx';
import {
  ArrowRightOutlined,
  ClearOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import styles from './index.module.css';

/**
 * The docs site has no dependency on `@portqueue/ui`, so it imports `@ant-design/icons`
 * directly (the dashboard goes through that package's curated `icons.ts` re-export instead).
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
    icon: DatabaseOutlined,
    title: 'Database Agnostic',
    body: (
      <>
        Point it at the database you already run — <strong>Postgres</strong>, <strong>MySQL</strong>
        , <strong>Oracle</strong>, <strong>PGLite</strong>, or <strong>SQLite</strong>. Each driver
        picks the best strategy its engine supports, so your app code stays identical.
      </>
    ),
    to: '/docs/getting-started',
    cta: 'Pick a driver',
  },
  {
    icon: DashboardOutlined,
    title: 'A Powerful Dashboard & CLI',
    body: 'A mountable React dashboard (plus a full CLI) to monitor and control both queues and instances live — pause, resume, retry, and watch throughput, with no third-party service.',
    to: '/docs/dashboard',
    cta: 'See the dashboard',
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
  {
    icon: ClearOutlined,
    title: 'Retention & Auto-Cleaning',
    body: 'Your table never fills up on its own. Pick a retention mode per queue or per job — keep the history forever, or delete after a TTL — and PortQueue does the cleanup in the background.',
    to: '/docs/guides/retention',
    cta: 'Configure retention',
  },
];

const QUICK_START = `import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

enum QueueName { Emails = 'emails' }

const pq = new PortQueue<QueueName>({
  driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }),
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
    'delayed & cron jobs, retries, retention, and rate limiting on Postgres, PGLite, SQLite, Oracle, or MySQL.';
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

        <section id="license" className={styles.section}>
          <h2 className={styles.sectionTitle}>License</h2>
          <p className={styles.sectionLead}>
            PortQueue is <strong>absolutely free</strong> — open source under the MIT license.
            Commercial use permitted, no license fee, no obligations. Use it in anything, forever.
          </p>
        </section>
      </main>
    </Layout>
  );
}
