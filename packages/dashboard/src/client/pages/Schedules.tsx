/** Schedules page: all recurring definitions across queues. Polls every 30s. */
import React from 'react';
import { Card, Space, Typography } from 'antd';
import type { ScheduleDto } from '../../shared/dto.js';
import { api } from '../queries/api.js';
import { usePoll } from '../queries/use-poll.js';
import { SchedulesPanel } from '../components/SchedulesPanel.js';
import { useStyles } from '../components/styles.js';

export function SchedulesPage(): React.ReactElement {
  const { styles } = useStyles();
  const schedules = usePoll<ScheduleDto[]>(() => api.getSchedules(), []);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Schedules
      </Typography.Title>
      <Card className={styles.card}>
        <SchedulesPanel
          rows={schedules.data ?? []}
          loading={schedules.loading}
          onChanged={schedules.refetch}
        />
      </Card>
    </Space>
  );
}
