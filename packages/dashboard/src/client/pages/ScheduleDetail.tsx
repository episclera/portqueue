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
import { Link, useHistory, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Code,
  Content,
  Inline,
  Mono,
  PageHeader,
  Popconfirm,
  Skeleton,
  Stack,
  Tag,
  Title,
} from '@portqueue/ui';
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
import styles from './ScheduleDetail.module.css';

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <dt className={styles.descLabel}>{label}</dt>
      <dd className={styles.descValue}>{children}</dd>
    </div>
  );
}

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
        <Content>
          <Stack gap={3}>
            <ErrorState
              title="Could not load this schedule"
              error={schedule.error}
              onRetry={() => void schedule.refetch()}
            />
            <Link to="/schedules">Back to schedules</Link>
          </Stack>
        </Content>
      </>
    );
  }

  const s = schedule.data;
  if (!s) {
    return (
      <>
        <PageHeader title="Schedule" subtitle="Loading the definition…" />
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

  /** Remove the definition, then leave for the list — this page's record no longer exists. */
  const remove = async (): Promise<void> => {
    const result = await run(
      { kind: ActionKind.REMOVE_SCHEDULE, scheduleId: s.scheduleId },
      'Schedule removed',
    );
    if (result) history.push('/schedules');
  };

  const actions = (
    <Inline gap={2} wrap>
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
        okDanger
        onConfirm={() => void remove()}
      >
        <Button variant="danger" icon={ACTIONS_CONFIG.remove.icon}>
          {ACTIONS_CONFIG.remove.label}
        </Button>
      </Popconfirm>
    </Inline>
  );

  return (
    <>
      <PageHeader
        title={
          <Inline gap={3} align="center" wrap>
            <Title level={4} as="span">
              Schedule
            </Title>
            {/* Truncated like a job id: the full value is one line down in the Definition card. */}
            <Mono>{truncate(s.scheduleId, 14, 8)}</Mono>
          </Inline>
        }
        subtitle={
          <Inline gap={2} align="center">
            <Tag tone={s.enabled ? 'success' : 'neutral'}>
              {s.enabled
                ? SCHEDULE_STATES_CONFIG.enabled.label
                : SCHEDULE_STATES_CONFIG.disabled.label}
            </Tag>
            <Link to={`/queues/${encodeURIComponent(s.queue)}`}>{s.queue}</Link>
          </Inline>
        }
        extra={actions}
      />
      <Content>
        <Stack gap={4}>
          <Card title="Definition">
            <dl className={styles.descGrid}>
              <Item label="Schedule id">
                <Mono>{s.scheduleId}</Mono>
              </Item>
              <Item label="Queue">
                <Link to={`/queues/${encodeURIComponent(s.queue)}`}>{s.queue}</Link>
              </Item>
              <Item label="Cadence">{s.cron ? <Code>{s.cron}</Code> : cadence(s)}</Item>
              <Item label="Timezone">{s.timezone ?? 'UTC'}</Item>
              <Item label="Next run">
                <Time value={s.nextRunAt} />
              </Item>
              <Item label="Last run">
                <Time value={s.lastRunAt} />
              </Item>
              <Item label="State">
                {s.enabled
                  ? SCHEDULE_STATES_CONFIG.enabled.label
                  : SCHEDULE_STATES_CONFIG.disabled.label}
              </Item>
              <Item label="Idempotency key">
                {s.idempotencyKey ? <Mono>{s.idempotencyKey}</Mono> : '—'}
              </Item>
            </dl>
          </Card>

          <Stack gap={2}>
            <Title level={5}>Jobs produced</Title>
            {/* Its own URL param prefix, so this table's paging never collides with another. */}
            <JobsTable queue={s.queue} scheduleId={s.scheduleId} prefix="scheduleJobs" />
          </Stack>
        </Stack>
      </Content>
    </>
  );
}
