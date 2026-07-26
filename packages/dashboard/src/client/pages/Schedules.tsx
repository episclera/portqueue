/** Schedules page: every recurring definition across queues, server-paged and polled. */
import React from 'react';
import { Content, PageHeader } from '@portqueue/ui';
import { SchedulesPanel } from '../components/SchedulesPanel';

export function SchedulesPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Schedules"
        subtitle="Recurring definitions and when they next fire, across every queue."
      />
      <Content>
        <SchedulesPanel />
      </Content>
    </>
  );
}
