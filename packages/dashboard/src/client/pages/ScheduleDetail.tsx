/**
 * Schedule detail: the definition in one card, and the jobs it has produced in another below it.
 *
 * The second card is the point of the page. A job's detail view links its `scheduleId` here, and
 * the jobs table is filtered to that id — which is what "which runs did this schedule produce,
 * and did they succeed?" needs, and what a link to the bare schedules list never answered.
 *
 * Removing the schedule leaves for the schedules list: the definition is gone, so this page has
 * nothing left to show.
 */
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Flex, Popconfirm, Skeleton, Tag, Typography } from 'antd';
import type { DescriptionsProps } from 'antd';
import { ActionKind, type ScheduleDto } from '../../shared/dto';
import { api } from '../queries/api';
import { queryKeys, usePolledQuery } from '../queries/use-queries';
import { useAction } from '../queries/use-action';
import { ACTIONS_CONFIG, SCHEDULE_STATES_CONFIG } from '../constants/labels';
import { JobsTable } from '../components/JobsTable';
import { cadence } from '../components/SchedulesPanel';
import { ErrorState } from '../components/states';
import { Time } from '../components/Time';
import { truncate } from '../components/format';
import { PageBody, PageHeader } from '../components/layout';
import { AppLink } from '../components/AppLink';

/** A monospaced value — ids, keys, cron patterns. */
const Mono = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <Typography.Text code>{children}</Typography.Text>
);

export function ScheduleDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const scheduleId = decodeURIComponent(id);
  const { run } = useAction();
  const history = useHistory();

  // Polled: `nextRunAt` and `lastRunAt` move on their own as the scheduler fires.
  const schedule = usePolledQuery<ScheduleDto>(queryKeys.schedule(scheduleId), () =>
    api.getSchedule(scheduleId),
  );

  if (schedule.error) {
    return (
      <>
        <PageHeader title="Schedule" subtitle="This schedule could not be loaded." />
        <PageBody>
          <ErrorState
            title="Could not load this schedule"
            error={schedule.error}
            onRetry={() => void schedule.refetch()}
          />
          <AppLink to="/schedules">Back to schedules</AppLink>
        </PageBody>
      </>
    );
  }

  const s = schedule.data;
  if (!s) {
    return (
      <>
        <PageHeader title="Schedule" subtitle="Loading the definition…" />
        <PageBody>
          <Card>
            <Skeleton active paragraph={{ rows: 4 }} />
          </Card>
        </PageBody>
      </>
    );
  }

  /** Remove the definition, then leave for the list — this page's record no longer exists. */
  const remove = async (): Promise<void> => {
    const result = await run(
      { kind: ActionKind.REMOVE_SCHEDULE, scheduleId: s.scheduleId },
      'Schedule removed',
    );
    if (result) history.push('/schedules');
  };

  const actions = (
    <Flex gap="small" wrap>
      {s.enabled ? (
        <Popconfirm
          title="Stop this schedule from firing?"
          description="The definition is kept, so you can re-enable it later."
          // Labelled with the action, as the row popovers are, rather than a bare "OK".
          okText="Disable"
          cancelText="Keep"
          onConfirm={() =>
            void run(
              {
                kind: ActionKind.SET_SCHEDULE_ENABLED,
                scheduleId: s.scheduleId,
                enabled: false,
              },
              'Schedule disabled',
            )
          }
        >
          <Button icon={ACTIONS_CONFIG.pause.icon}>Disable</Button>
        </Popconfirm>
      ) : (
        <Button
          icon={ACTIONS_CONFIG.resume.icon}
          onClick={() =>
            void run(
              {
                kind: ActionKind.SET_SCHEDULE_ENABLED,
                scheduleId: s.scheduleId,
                enabled: true,
              },
              'Schedule enabled',
            )
          }
        >
          Enable
        </Button>
      )}
      <Popconfirm
        title="Remove this schedule?"
        description="It stops firing permanently. Jobs it already created are kept."
        okText={ACTIONS_CONFIG.remove.label}
        cancelText="Keep"
        okButtonProps={{ danger: true }}
        onConfirm={() => void remove()}
      >
        <Button danger icon={ACTIONS_CONFIG.remove.icon}>
          {ACTIONS_CONFIG.remove.label}
        </Button>
      </Popconfirm>
    </Flex>
  );

  const stateLabel = s.enabled
    ? SCHEDULE_STATES_CONFIG.enabled.label
    : SCHEDULE_STATES_CONFIG.disabled.label;
  const queueLink = <AppLink to={`/queues/${encodeURIComponent(s.queue)}`}>{s.queue}</AppLink>;

  const definition: DescriptionsProps['items'] = [
    { key: 'id', label: 'Schedule id', children: <Mono>{s.scheduleId}</Mono> },
    { key: 'queue', label: 'Queue', children: queueLink },
    { key: 'cadence', label: 'Cadence', children: s.cron ? <Mono>{s.cron}</Mono> : cadence(s) },
    { key: 'timezone', label: 'Timezone', children: s.timezone ?? 'UTC' },
    { key: 'next', label: 'Next run', children: <Time value={s.nextRunAt} /> },
    { key: 'last', label: 'Last run', children: <Time value={s.lastRunAt} /> },
    { key: 'state', label: 'State', children: stateLabel },
    {
      key: 'idempotency',
      label: 'Idempotency key',
      children: s.idempotencyKey ? <Mono>{s.idempotencyKey}</Mono> : '—',
    },
  ];

  return (
    <>
      <PageHeader
        title={
          <Flex gap="middle" align="center" wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Schedule
            </Typography.Title>
            {/* Truncated like a job id: the full value is one line down in the Definition card. */}
            <Mono>{truncate(s.scheduleId, 14, 8)}</Mono>
          </Flex>
        }
        subtitle={
          <Flex gap="small" align="center" component="span">
            <Tag color={s.enabled ? 'success' : 'default'}>{stateLabel}</Tag>
            {queueLink}
          </Flex>
        }
        extra={actions}
      />
      <PageBody>
        <Card title="Definition">
          <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} items={definition} />
        </Card>

        <Flex vertical gap="small">
          <Typography.Title level={5} style={{ margin: 0 }}>
            Jobs produced
          </Typography.Title>
          {/* Its own URL param prefix, so this table's paging never collides with another. */}
          <JobsTable queue={s.queue} scheduleId={s.scheduleId} prefix="scheduleJobs" />
        </Flex>
      </PageBody>
    </>
  );
}
