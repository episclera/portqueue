/**
 * Instance detail: the health of the Node process behind this instance in one row of cards, every
 * job it has processed in a table below, and the same pause/resume + remove controls the instances
 * list row carries — an operator who followed a link here shouldn't have to go back to the list to
 * act on what they see.
 *
 * The two halves answer different questions and both need the instance as their subject. The cards
 * are the process health it recorded on its last heartbeat — the instances list shows the same
 * numbers, but a row of columns is where you notice a number, not where you sit and read it. The
 * table is filtered to the jobs this instance claimed, which is the question the instances list
 * can't answer at all: "this one looks busy — busy with what?"
 */
import React from 'react';
import { Link, useHistory, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Content,
  Inline,
  Mono,
  PageHeader,
  Popconfirm,
  Row,
  Skeleton,
  Stack,
  Statistic,
  Tag,
  Title,
  Tooltip,
} from '@portqueue/ui';
import type { StatisticTone } from '@portqueue/ui';
import { ActionKind, type InstanceDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import {
  ACTIONS_CONFIG,
  INSTANCE_ACTIONS_COPY,
  LIVENESS_CONFIG,
  instanceRemovable,
  pauseStateLabel,
} from '../constants/labels';
import { JobsTable } from '../components/JobsTable';
import { ErrorState } from '../components/states';
import { Time } from '../components/Time';
import { totalCount } from '../components/format';
import { METRIC_HINTS, formatPercent } from '../components/metrics';

/** Three cards on one row across a 24-column grid. */
const CARD_SPAN = 8;

export function InstanceDetailPage(): React.ReactElement {
  const { key } = useParams<{ key: string }>();
  const instanceKey = decodeURIComponent(key);
  const { run } = useAction();
  const history = useHistory();

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

  // Health readings are never toned: see `components/metrics` — there is no value that is "bad"
  // on its own, so every card here is the default colour.
  const cards: { label: string; value: string; tone: StatisticTone; hint: string }[] = [
    {
      label: 'CPU (process)',
      value: formatPercent(i.cpuPercent),
      tone: 'default',
      hint: METRIC_HINTS.cpu,
    },
    {
      label: 'Memory (process)',
      value: formatPercent(i.memoryPercent),
      tone: 'default',
      hint: METRIC_HINTS.memory,
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

  /** Removing the instance leaves this URL with no record to show, so a success leaves for the list. */
  const remove = async (): Promise<void> => {
    const result = await run(
      { kind: ActionKind.REMOVE_INSTANCE, instanceKey: i.instanceKey },
      'Instance removed',
    );
    if (result) history.push('/instances');
  };

  /**
   * The same two actions the instances table row offers, on the same rules — pause is confirmed,
   * and remove stays disabled (saying why) until core would accept it.
   */
  const removable = instanceRemovable(i);
  const actions = (
    <Inline gap={2} align="center" wrap>
      {i.processingPaused ? (
        <Button
          icon={ACTIONS_CONFIG.resume.icon}
          onClick={() =>
            void run({ kind: ActionKind.RESUME_INSTANCE, instanceKey: i.instanceKey }, 'Resumed')
          }
        >
          {ACTIONS_CONFIG.resume.label}
        </Button>
      ) : (
        <Popconfirm
          title={INSTANCE_ACTIONS_COPY.pauseConfirm}
          okText={ACTIONS_CONFIG.pause.label}
          cancelText="Keep"
          onConfirm={() =>
            void run({ kind: ActionKind.PAUSE_INSTANCE, instanceKey: i.instanceKey }, 'Paused')
          }
        >
          <Button icon={ACTIONS_CONFIG.pause.icon}>{ACTIONS_CONFIG.pause.label}</Button>
        </Popconfirm>
      )}
      {/* Disabled rather than hidden, as in the table: a button that materialises half an hour
          later is worse than one that says what it is waiting for. */}
      <Tooltip
        title={removable ? ACTIONS_CONFIG.remove.label : INSTANCE_ACTIONS_COPY.removeBlocked}
        placement="bottom"
      >
        <Popconfirm
          title={INSTANCE_ACTIONS_COPY.removeConfirm}
          description={INSTANCE_ACTIONS_COPY.removeConfirmDescription}
          okText={ACTIONS_CONFIG.remove.label}
          cancelText="Keep"
          okDanger
          onConfirm={() => void remove()}
        >
          <Button variant="danger" icon={ACTIONS_CONFIG.remove.icon} disabled={!removable}>
            {ACTIONS_CONFIG.remove.label}
          </Button>
        </Popconfirm>
      </Tooltip>
    </Inline>
  );

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
        extra={actions}
      />
      <Content>
        <Stack gap={4}>
          <Row gutter={16}>
            {cards.map((card) => (
              <Col key={card.label} span={CARD_SPAN}>
                <Card>
                  {/* Hover says what the number is: both health cards read this Node process, and
                      an operator who takes them for the machine's load misreads them. */}
                  <Tooltip title={card.hint} placement="bottom" block>
                    <Statistic label={card.label} value={card.value} tone={card.tone} />
                  </Tooltip>
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
