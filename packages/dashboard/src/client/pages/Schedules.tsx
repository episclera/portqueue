/** Schedules page: every recurring definition across queues. Polls every 30s. */
import React from 'react';
import { Content, PageHeader } from '@portqueue/ui';
import type { ScheduleDto } from '../../shared/dto';
import { api } from '../queries/api';
import { usePoll } from '../queries/use-poll';
import { SchedulesPanel } from '../components/SchedulesPanel';

export function SchedulesPage(): React.ReactElement {
  const schedules = usePoll<ScheduleDto[]>(() => api.getSchedules(), []);

  return (
    <>
      <PageHeader
        title="Schedules"
        subtitle="Recurring definitions and when they next fire, across every queue."
      />
      <Content>
        <SchedulesPanel
          rows={schedules.data ?? []}
          loading={schedules.loading && !schedules.data}
          onChanged={schedules.refetch}
        />
      </Content>
    </>
  );
}
