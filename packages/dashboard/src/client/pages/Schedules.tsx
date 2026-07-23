/** Schedules page: all recurring definitions across queues. Polls every 30s. */
import React from 'react';
import { Card, Stack, Title } from '@portqueue/ui';
import type { ScheduleDto } from '../../shared/dto.js';
import { api } from '../queries/api.js';
import { usePoll } from '../queries/use-poll.js';
import { SchedulesPanel } from '../components/SchedulesPanel.js';

export function SchedulesPage(): React.ReactElement {
  const schedules = usePoll<ScheduleDto[]>(() => api.getSchedules(), []);

  return (
    <Stack gap={4} style={{ width: '100%' }}>
      <Title level={3}>Schedules</Title>
      <Card>
        <SchedulesPanel
          rows={schedules.data ?? []}
          loading={schedules.loading}
          onChanged={schedules.refetch}
        />
      </Card>
    </Stack>
  );
}
