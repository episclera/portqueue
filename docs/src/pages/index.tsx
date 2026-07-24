import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import styled from 'styled-components';
import { DRIVERS } from '@site/src/constants/drivers';

const FEATURES: { icon: string; title: string; body: ReactNode; to: string; cta: string }[] = [
  {
    icon: '🌐',
    title: 'Scales to Many Servers',
    body: 'Add a server and it just starts claiming — no leader election, no reconfiguration. Instances cooperate through row-level claiming, so no job runs twice, and a job can target a preferred server when it needs one.',
    to: '/docs/scale-horizontally',
    cta: 'How it scales',
  },
  {
    icon: '🗄️',
    title: 'Database Agnostic',
    body: (
      <>
        Point it at the database you already run — <strong>Postgres</strong>, <strong>MySQL</strong>,{' '}
        <strong>Oracle</strong>, <strong>PGLite</strong>, or <strong>SQLite</strong>. Each driver picks
        the best strategy its engine supports, so your app code stays identical.
      </>
    ),
    to: '/docs/getting-started/installation',
    cta: 'Pick a driver',
  },
  {
    icon: '🖥️',
    title: 'A Powerful Dashboard & CLI',
    body: 'A mountable React dashboard (plus a full CLI) to monitor and control both queues and instances live — pause, resume, retry, and watch throughput, with no third-party service.',
    to: '/docs/dashboard',
    cta: 'See the dashboard',
  },
  {
    icon: '🔁',
    title: 'Workflows',
    body: 'Multi-step jobs where each step is its own row — crash-safe and resumable, with same-machine affinity, not a fragile numeric progress counter.',
    to: '/docs/workflows/what-is-a-workflow',
    cta: 'Build a workflow',
  },
  {
    icon: '⏰',
    title: 'Scheduling & Cron',
    body: 'Delayed jobs, fixed intervals, and cron with timezones — all through one addJob method.',
    to: '/docs/guides/scheduling',
    cta: 'Schedule jobs',
  },
  {
    icon: '🛡️',
    title: 'Fault-Tolerant & Observable',
    body: 'Automatic retries with backoff, stalled-job reclaim, liveness-aware fallback, and at-least-once delivery — with rich events and hooks for metrics and tracing.',
    to: '/docs/events-hooks/events',
    cta: 'Events & hooks',
  },
];

const DRIVER_PILLS = [...DRIVERS.map((d) => d.label), 'Custom driver'];

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

const Hero = styled.header`
  position: relative;
  overflow: hidden;
  padding: 6rem 1rem 5rem;
  text-align: center;
  background:
    radial-gradient(1200px 500px at 50% -10%, rgba(169, 216, 184, 0.3), transparent 70%),
    radial-gradient(900px 400px at 85% 10%, rgba(143, 184, 216, 0.22), transparent 65%);
`;

const HeroBrand = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-bottom: 0.25rem;
`;

const HeroLogo = styled.img`
  width: 88px;
  height: 88px;
  filter: drop-shadow(0 8px 24px rgba(111, 161, 132, 0.3));
`;

const HeroTitle = styled.h1`
  font-size: clamp(2.4rem, 6vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  margin: 0;
  color: var(--primary-dark);
`;

const HeroTagline = styled.p`
  font-size: clamp(1.05rem, 2.5vw, 1.4rem);
  max-width: 42rem;
  margin: 0 auto 1rem;
  opacity: 0.85;
`;

const Ctas = styled.div`
  display: flex;
  gap: 0.9rem;
  justify-content: center;
  flex-wrap: wrap;
`;

const CtaButton = styled(Link)<{ $variant?: 'primary' | 'secondary' }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 46px;
  padding: 0 1.4rem;
  border-radius: 10px;
  font-weight: 700;
  font-size: 1rem;
  text-decoration: none;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
  border: 1px solid
    ${(p) => (p.$variant === 'primary' ? 'var(--primary)' : 'var(--secondary)')};
  background: ${(p) => (p.$variant === 'primary' ? 'var(--primary)' : 'var(--surface)')};
  /* On the green primary fill, text is always the near-black brand text (never white),
     in both light and dark themes; the surface secondary follows the theme text colour. */
  color: ${(p) => (p.$variant === 'primary' ? '#1b1f1d' : 'var(--text)')};
  &:hover {
    text-decoration: none;
    color: ${(p) => (p.$variant === 'primary' ? '#1b1f1d' : 'var(--text)')};
    transform: translateY(-1px);
    background: ${(p) => (p.$variant === 'primary' ? 'var(--primary-dark)' : 'var(--surface)')};
    border-color: var(--primary);
  }
`;

const Section = styled.section<{ $tight?: boolean }>`
  max-width: 1120px;
  margin: 0 auto;
  padding: ${(p) => (p.$tight ? '1.5rem 1.25rem 4rem' : '4rem 1.25rem')};
`;

const SectionTitle = styled.h2`
  text-align: center;
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 0.5rem;
`;

const SectionLead = styled.p`
  text-align: center;
  opacity: 0.75;
  max-width: 40rem;
  margin: 0 auto 2.5rem;
`;

const FeatureGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1.25rem;
`;

const Feature = styled.div`
  display: flex;
  flex-direction: column;
  padding: 1.6rem;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--secondary);
  box-shadow: var(--ifm-global-shadow-md);
  transition: transform 200ms ease, box-shadow 200ms ease;
  &:hover {
    transform: translateY(-3px);
    box-shadow: var(--ifm-global-shadow-tl);
  }
  @media (prefers-reduced-motion: reduce) {
    &,
    &:hover {
      transform: none;
    }
  }
`;

const FeatureIcon = styled.span`
  font-size: 1.75rem;
  margin-bottom: 0.5rem;
  display: block;
`;

const FeatureTitle = styled.div`
  font-weight: 700;
  margin-bottom: 0.35rem;
`;

const FeatureBody = styled.p`
  font-size: 0.95rem;
  opacity: 0.8;
  margin: 0;
`;

const FeatureLink = styled(Link)`
  margin-top: auto;
  padding-top: 1rem;
  align-self: flex-start;
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--primary-dark);
  &:hover {
    text-decoration: none;
    color: var(--primary);
  }
`;

const Drivers = styled.div`
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
`;

const DriverPill = styled.span`
  padding: 0.55rem 1.2rem;
  border-radius: 999px;
  font-weight: 600;
  background: var(--surface);
  border: 1px solid var(--secondary);
`;

const ScaleStrip = styled.div`
  text-align: center;
  border-radius: 24px;
  padding: 3rem 1.5rem;
  background: linear-gradient(120deg, rgba(169, 216, 184, 0.28), rgba(143, 184, 216, 0.18));
`;

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="PortQueue" description={siteConfig.tagline}>
      <Hero>
        <HeroBrand>
          <HeroLogo src="/portqueue/img/logo.svg" alt="PortQueue logo" />
          <HeroTitle>PortQueue</HeroTitle>
        </HeroBrand>
        <HeroTagline>{siteConfig.tagline}</HeroTagline>
        <Ctas>
          <CtaButton $variant="primary" to="/docs/getting-started/installation">
            Get Started
          </CtaButton>
          <CtaButton
            $variant="secondary"
            to="https://github.com/episclera/portqueue"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </CtaButton>
        </Ctas>
      </Hero>

      <main>
        <Section $tight>
          <FeatureGrid>
            {FEATURES.map((f) => (
              <Feature key={f.title}>
                <FeatureIcon aria-hidden>{f.icon}</FeatureIcon>
                <FeatureTitle>{f.title}</FeatureTitle>
                <FeatureBody>{f.body}</FeatureBody>
                <FeatureLink to={f.to}>{f.cta} →</FeatureLink>
              </Feature>
            ))}
          </FeatureGrid>
        </Section>

        <Section>
          <SectionTitle>At a glance</SectionTitle>
          <SectionLead>Add a job, process it on a worker. Same code on any driver.</SectionLead>
          <CodeBlock language="ts" title="app.ts">
            {QUICK_START}
          </CodeBlock>
        </Section>

        <Section>
          <SectionTitle>Runs on your database</SectionTitle>
          <SectionLead>Swap the driver import — your app code stays identical.</SectionLead>
          <Drivers>
            {DRIVER_PILLS.map((d) => (
              <DriverPill key={d}>{d}</DriverPill>
            ))}
          </Drivers>
        </Section>

        <Section>
          <ScaleStrip>
            <SectionTitle>Built to scale horizontally</SectionTitle>
            <SectionLead>
              Per-queue claim loops with SKIP LOCKED let N instances cooperate on one queue —
              no leader election, no coordinator, and no cross-queue head-of-line blocking.
              Jobs can target a preferred server by pattern, and database pub/sub
              (LISTEN/NOTIFY) wakes workers the moment work lands, so it stays reactive without
              busy polling.
            </SectionLead>
            <CtaButton $variant="primary" to="/docs/scale-horizontally">
              How it scales
            </CtaButton>
          </ScaleStrip>
        </Section>
      </main>
    </Layout>
  );
}
