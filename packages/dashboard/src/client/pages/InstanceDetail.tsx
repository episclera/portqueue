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
import { useHistory, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Flex,
  Popconfirm,
  Row,
  Skeleton,
  Statistic,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { ActionKind, type InstanceDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { ACTIONS_CONFIG, INSTANCE_ACTIONS_COPY, instanceRemovable } from '../constants/labels';
import { JobsTable } from '../components/JobsTable';
import { ErrorState } from '../components/states';
import { Time } from '../components/Time';
import { totalCount } from '../components/format';
import { METRIC_HINTS, formatPercent, metricTone, type MetricTone } from '../components/metrics';
import { PageBody, PageHeader } from '../components/layout';
import { AppLink } from '../components/AppLink';
import { InfoIcon } from '../icons';
import { LivenessTag, PauseStateTag } from '../components/StateTags';

/** Three cards on one row across a 24-column grid. */
const CARD_SPAN = 8;

export function InstanceDetailPage(): React.ReactElement {
  const { key } = useParams<{ key: string }>();
  const instanceKey = decodeURIComponent(key);
  const { run } = useAction();
  const history = useHistory();
  const { token } = theme.useToken();

  /** The metric colouring, in the theme's semantic colours. */
  const toneColor: Record<MetricTone, string | undefined> = {
    normal: undefined,
    warn: token.colorWarning,
    danger: token.colorError,
  };

  // Polled: every heartbeat moves `lastSeenAt` and the health numbers.
  const instance = usePolledQuery<InstanceDto>(queryKeys.instance(instanceKey), () =>
    api.getInstance(instanceKey),
  );

  if (instance.error) {
    return (
      <>
        <PageHeader
          entity="Instance"
          title={instanceKey}
          subtitle="This instance could not be loaded."
        />
        <PageBody>
          <ErrorState
            title="Could not load this instance"
            error={instance.error}
            onRetry={() => void instance.refetch()}
          />
          <AppLink to="/instances">Back to instances</AppLink>
        </PageBody>
      </>
    );
  }

  const i = instance.data;
  if (!i) {
    return (
      <>
        <PageHeader entity="Instance" title={instanceKey} subtitle="Loading this instance…" />
        <PageBody>
          <Card>
            <Skeleton active paragraph={{ rows: 4 }} />
          </Card>
        </PageBody>
      </>
    );
  }

  const cards: { label: string; value: string; color: string | undefined; hint: string }[] = [
    {
      label: 'CPU (process)',
      value: formatPercent(i.cpuPercent),
      color: toneColor[metricTone(i.cpuPercent)],
      hint: METRIC_HINTS.cpu,
    },
    {
      label: 'Memory (process)',
      value: formatPercent(i.memoryPercent),
      color: toneColor[metricTone(i.memoryPercent)],
      hint: METRIC_HINTS.memory,
    },
    {
      // "Processed", matching the instances table's column, so the same number isn't named two
      // things — and so it doesn't collide with the "Jobs processed" heading below.
      label: 'Processed',
      value: String(totalCount(i.counts)),
      color: undefined,
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
    <Flex gap="small" align="center" wrap>
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
        title={
          removable
            ? ACTIONS_CONFIG.remove.label
            : INSTANCE_ACTIONS_COPY.removeBlocked(i.removableAfter)
        }
        placement="bottom"
      >
        <Popconfirm
          title={INSTANCE_ACTIONS_COPY.removeConfirm}
          description={INSTANCE_ACTIONS_COPY.removeConfirmDescription}
          okText={ACTIONS_CONFIG.remove.label}
          cancelText="Keep"
          okButtonProps={{ danger: true }}
          onConfirm={() => void remove()}
          disabled={!removable}
        >
          <Button danger icon={ACTIONS_CONFIG.remove.icon} disabled={!removable}>
            {ACTIONS_CONFIG.remove.label}
          </Button>
        </Popconfirm>
      </Tooltip>
    </Flex>
  );

  return (
    <>
      <PageHeader
        entity="Instance"
        title={i.instanceKey}
        tags={
          <>
            <LivenessTag alive={i.alive} />
            <PauseStateTag row={i} />
          </>
        }
        subtitle={
          <span>
            Last seen <Time value={i.lastSeenAt} />
          </span>
        }
        extra={actions}
      />
      <PageBody>
        <Row gutter={[16, 16]}>
          {cards.map((card) => (
            <Col key={card.label} xs={24} md={CARD_SPAN}>
              <Card>
                {/* The explanation sits on a visible info icon after the title, not on a hover
                    over the whole card: a card-wide tooltip is invisible until stumbled on, and
                    both health cards need saying — they read this Node process, and an operator
                    who takes them for the machine's load misreads them. */}
                <Statistic
                  title={
                    <Flex gap={6} align="center" component="span">
                      {card.label}
                      <Tooltip title={card.hint} trigger={['hover', 'focus']}>
                        <InfoIcon tabIndex={0} aria-label={`About ${card.label}`} />
                      </Tooltip>
                    </Flex>
                  }
                  value={card.value}
                  styles={{ content: { color: card.color } }}
                />
              </Card>
            </Col>
          ))}
        </Row>

        <Flex vertical gap="small">
          <Typography.Title level={5} style={{ margin: 0 }}>
            Jobs processed
          </Typography.Title>
          {/* Its own URL param prefix, so this table's paging never collides with another. */}
          <JobsTable instanceKey={i.instanceKey} prefix="instanceJobs" />
        </Flex>
      </PageBody>
    </>
  );
}
