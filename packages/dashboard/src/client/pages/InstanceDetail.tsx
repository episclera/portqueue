/**
 * Instance detail: how this process is doing in one row of cards, and every job it has processed in
 * a table below.
 *
 * The two halves answer different questions and both need the instance as their subject. The cards
 * are the health it recorded on its last heartbeat — the instances list shows the same numbers, but
 * a row of eight columns is where you notice a number, not where you sit and read it. The table is
 * filtered to the jobs this instance claimed, which is the question the instances list can't answer
 * at all: "this one looks busy — busy with what?"
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Card,
  Col,
  Content,
  Inline,
  Mono,
  PageHeader,
  Row,
  Skeleton,
  Stack,
  Statistic,
  Tag,
  Title,
} from '@portqueue/ui';
import type { StatisticTone } from '@portqueue/ui';
import type { InstanceDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { LIVENESS_CONFIG, pauseStateLabel } from '../constants/labels';
import { JobsTable } from '../components/JobsTable';
import { ErrorState } from '../components/states';
import { Time } from '../components/Time';
import { totalCount } from '../components/format';
import {
  CPU_THRESHOLDS,
  MEMORY_THRESHOLDS,
  formatBytes,
  formatPercent,
  metricTone,
  type MetricTone,
} from '../components/metrics';

/** Four cards on one row: 24 columns don't divide by four evenly, so each takes six. */
const CARD_SPAN = 6;

/** The metric colouring maps onto the card component's own tones. */
const CARD_TONE: Record<MetricTone, StatisticTone> = {
  normal: 'default',
  warn: 'warning',
  danger: 'danger',
};

export function InstanceDetailPage(): React.ReactElement {
  const { key } = useParams<{ key: string }>();
  const instanceKey = decodeURIComponent(key);

  // Polled: every heartbeat moves `lastSeenAt` and the health numbers.
  const instance = usePolledQuery<InstanceDto>(queryKeys.instance(instanceKey), () =>
    api.getInstance(instanceKey),
  );

  if (instance.error) {
    return (
      <>
        <PageHeader title="Instance" subtitle="This instance could not be loaded." />
        <Content>
          <Stack gap={3}>
            <ErrorState
              title="Could not load this instance"
              error={instance.error}
              onRetry={() => void instance.refetch()}
            />
            <Link to="/instances">Back to instances</Link>
          </Stack>
        </Content>
      </>
    );
  }

  const i = instance.data;
  if (!i) {
    return (
      <>
        <PageHeader title="Instance" subtitle="Loading this instance…" />
        <Content>
          <Card>
            <Stack gap={3}>
              <Skeleton height={18} width="40%" />
              <Skeleton height={100} />
            </Stack>
          </Card>
        </Content>
      </>
    );
  }

  const cpuTone = metricTone(i.cpuPercent, CPU_THRESHOLDS);
  const memoryTone = metricTone(i.memoryPercent, MEMORY_THRESHOLDS);

  const cards: { label: string; value: string; tone: StatisticTone; hint: string }[] = [
    {
      label: 'CPU',
      value: formatPercent(i.cpuPercent),
      tone: CARD_TONE[cpuTone],
      hint: 'Process CPU since the previous sample, summed across cores',
    },
    {
      label: 'Memory',
      value: formatPercent(i.memoryPercent),
      tone: CARD_TONE[memoryTone],
      hint: 'RSS as a share of total machine memory',
    },
    {
      // Same quantity as the memory share, so it carries that reading's tone: what counts as "a
      // lot" of RSS depends on the machine, which an absolute byte threshold can't know.
      label: 'RSS',
      value: formatBytes(i.rssBytes),
      tone: CARD_TONE[memoryTone],
      hint: 'Resident set size at the last heartbeat',
    },
    {
      // "Processed", matching the instances table's column, so the same number isn't named two
      // things — and so it doesn't collide with the "Jobs processed" heading below.
      label: 'Processed',
      value: String(totalCount(i.counts)),
      tone: 'default',
      hint: 'Every job this instance has claimed, in any state',
    },
  ];

  return (
    <>
      <PageHeader
        title={
          <Inline gap={3} align="center" wrap>
            <Title level={4} as="span">
              Instance
            </Title>
            <Mono>{i.instanceKey}</Mono>
          </Inline>
        }
        subtitle={
          <Inline gap={2} align="center" wrap>
            <Tag tone={i.alive ? 'success' : 'neutral'}>
              {i.alive ? LIVENESS_CONFIG.alive.label : LIVENESS_CONFIG.stale.label}
            </Tag>
            <Tag tone={i.processingPaused ? 'warning' : 'success'}>{pauseStateLabel(i)}</Tag>
            <span>
              Last seen <Time value={i.lastSeenAt} />
            </span>
          </Inline>
        }
      />
      <Content>
        <Stack gap={4}>
          <Row gutter={16}>
            {cards.map((card) => (
              <Col key={card.label} span={CARD_SPAN}>
                <Card>
                  <div title={card.hint}>
                    <Statistic label={card.label} value={card.value} tone={card.tone} />
                  </div>
                </Card>
              </Col>
            ))}
          </Row>

          <Stack gap={2}>
            <Title level={5}>Jobs processed</Title>
            {/* Its own URL param prefix, so this table's paging never collides with another. */}
            <JobsTable instanceKey={i.instanceKey} prefix="instanceJobs" />
          </Stack>
        </Stack>
      </Content>
    </>
  );
}
