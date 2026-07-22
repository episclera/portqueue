import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import styles from './index.module.css';

const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: '🗄️',
    title: 'Multi-driver',
    body: 'First-class Postgres, PGLite, SQLite, and Oracle drivers — plus a custom-driver interface. One API across every engine.',
  },
  {
    icon: '🚫',
    title: 'No broker needed',
    body: 'Your database is the single source of truth. No Redis, no message broker to run or pay for.',
  },
  {
    icon: '📈',
    title: 'Horizontally scalable',
    body: 'Instances cooperate through row-level claiming (SKIP LOCKED) and visibility timeouts — no double-processing.',
  },
  {
    icon: '🔒',
    title: 'Transactional enqueue',
    body: 'A job exists only if your business transaction commits. Pass a tx adapter and kill the dual-write bug.',
  },
  {
    icon: '⏰',
    title: 'Cron & scheduling',
    body: 'Delayed jobs, fixed intervals, and cron with timezones — one addJob method, no separate schedule() call.',
  },
  {
    icon: '🔁',
    title: 'Resumable workflows',
    body: 'Multi-step jobs where each step is its own row — crash-safe and resumable, not fragile numeric progress.',
  },
  {
    icon: '🚦',
    title: 'Rate limiting & backpressure',
    body: 'Cluster-wide queue caps, per-worker local limits, and system-pressure backpressure built in.',
  },
  {
    icon: '🖥️',
    title: 'Dashboard + CLI',
    body: 'Operational visibility with a mountable dashboard and a full CLI — no third-party service.',
  },
  {
    icon: '🧩',
    title: 'Strictly typed',
    body: 'Named options, importable enums, and payload types that flow through generics end to end. No any.',
  },
];

const DRIVERS = ['Postgres', 'PGLite', 'SQLite', 'Oracle', 'Custom driver'];

const QUICK_START = `import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

enum QueueName { Emails = 'emails' }

const pq = new PortQueue<QueueName>({
  driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }),
});
await pq.init();

// Producer — add a job (data is a named key, never positional).
const emails = pq.createQueue<{ to: string }>(QueueName.Emails);
await emails.addJob({ data: { to: 'a@b.com' } });

// Consumer — registering a worker is enough; it claims automatically.
pq.createWorker({
  queue: QueueName.Emails,
  concurrency: 10,
  handler: async (job) => { await sendEmail(job.data); },
});`;

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="PortQueue" description={siteConfig.tagline}>
      <header className={styles.hero}>
        <img src="/portqueue/img/logo.svg" alt="PortQueue logo" className={styles.heroLogo} />
        <h1 className={styles.heroTitle}>PortQueue</h1>
        <p className={styles.heroTagline}>{siteConfig.tagline}</p>
        <p className={styles.license}>
          Free and open source. Commercial use permitted. No license fee, no obligations.
        </p>
        <div className={styles.ctas}>
          <Link
            className="button button--primary button--lg"
            to="/docs/getting-started/installation"
          >
            Get Started
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="https://github.com/episclera/portqueue"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Link>
        </div>
      </header>

      <main>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Everything a real workload needs</h2>
          <p className={styles.sectionLead}>
            The best ergonomics of pg-boss and BullMQ with the operational maturity of Celery — on
            the database you already run.
          </p>
          <div className={styles.featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden>
                  {f.icon}
                </span>
                <div className={styles.featureTitle}>{f.title}</div>
                <p className={styles.featureBody}>{f.body}</p>
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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Runs on your database</h2>
          <p className={styles.sectionLead}>
            Swap the driver import — your app code stays identical.
          </p>
          <div className={styles.drivers}>
            {DRIVERS.map((d) => (
              <span key={d} className={styles.driverPill}>
                {d}
              </span>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.scaleStrip}>
            <h2 className={styles.sectionTitle}>Built to scale horizontally</h2>
            <p className={styles.sectionLead}>
              Per-queue claim loops, SKIP LOCKED, and visibility timeouts let N instances cooperate
              on one queue with no leader election and no cross-queue blocking.
            </p>
            <Link className="button button--primary button--lg" to="/docs/scalability">
              How it scales
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
