/**
 * Instances page: every registered instance with liveness, per-instance job
 * attribution, and per-instance pause/resume. Only populated when instances run in
 * multi-instance mode (an `instanceKey` on the PortQueue). Polls every 30s.
 */
import React from 'react';
import styled from 'styled-components';
import {
  Button,
  Card,
  Inline,
  Popconfirm,
  SkeletonText,
  Stack,
  StatusTag,
  Table,
  Tag,
  Text,
  Title,
  Tooltip,
} from '@portqueue/ui';
import type { TableColumn } from '@portqueue/ui';
import { JobStatus } from '../queries/enums.js';
import type { InstanceDto } from '../../shared/dto.js';
import { api, config } from '../queries/api.js';
import { usePoll } from '../queries/use-poll.js';
import { useAction } from '../queries/use-action.js';
import { totalCount, formatDate } from '../components/format.js';

const Hero = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Mono = styled.span`
  font-family: ${(p) => p.theme.font.mono};
`;

const EMPTY_TEXT =
  'No instances registered. Set an `instanceKey` on the PortQueue to enable multi-instance mode.';

export function InstancesPage(): React.ReactElement {
  const { run } = useAction();
  const instances = usePoll<InstanceDto[]>(() => api.getInstances(), []);

  const columns: TableColumn<InstanceDto>[] = [
    {
      title: 'Instance',
      key: 'instanceKey',
      render: (r) => (
        <Inline gap={2} align="center">
          <Mono>{r.instanceKey}</Mono>
          <Tag tone={r.alive ? 'success' : 'neutral'}>{r.alive ? 'alive' : 'stale'}</Tag>
          {r.processingPaused && <Tag tone="warning">paused</Tag>}
        </Inline>
      ),
    },
    {
      title: 'Total',
      key: 'total',
      render: (r) => totalCount(r.counts),
    },
    ...([JobStatus.ACTIVE, JobStatus.RETRY, JobStatus.FAILED, JobStatus.COMPLETED] as JobStatus[]).map(
      (s): TableColumn<InstanceDto> => ({
        title: <StatusTag status={s} />,
        key: s,
        render: (r) => r.counts[s] ?? 0,
      }),
    ),
    {
      title: 'Last seen',
      key: 'lastSeenAt',
      render: (r) => (
        <Tooltip title={formatDate(r.lastSeenAt)}>
          <span>{formatDate(r.lastSeenAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (r) => {
        if (config.readOnly) return null;
        // Match the core rule: an instance may only be removed after 30 minutes unseen.
        const removable = Date.now() - new Date(r.lastSeenAt).getTime() > 30 * 60 * 1000;
        return (
          <Inline gap={2} align="center">
            {r.processingPaused ? (
              <Button
                size="sm"
                icon="▶️"
                onClick={() =>
                  void run({ kind: 'resumeInstance', instanceKey: r.instanceKey }, 'Resumed')
                }
              >
                Resume
              </Button>
            ) : (
              <Popconfirm
                title="Pause job processing on this instance?"
                onConfirm={() =>
                  void run({ kind: 'pauseInstance', instanceKey: r.instanceKey }, 'Paused')
                }
              >
                <Button size="sm" icon="⏸️">
                  Pause
                </Button>
              </Popconfirm>
            )}
            {removable && (
              <Popconfirm
                title="Remove this inactive instance from monitoring?"
                description="Only tidies the instances list; job history is untouched."
                okDanger
                onConfirm={() =>
                  void run({ kind: 'removeInstance', instanceKey: r.instanceKey }, 'Instance removed')
                }
              >
                <Button size="sm" variant="danger" icon="🗑️">
                  Remove
                </Button>
              </Popconfirm>
            )}
          </Inline>
        );
      },
    },
  ];

  return (
    <Stack gap={4}>
      <Hero>
        <Title level={3}>Instances</Title>
        <Text $tone="muted">
          Liveness and per-instance job attribution across the cluster.
        </Text>
      </Hero>

      <Card title="Registered instances" bodyPadding={false}>
        {instances.loading && !instances.data ? (
          <div style={{ padding: 16 }}>
            <SkeletonText rows={4} />
          </div>
        ) : (
          <Table<InstanceDto>
            rowKey={(r) => r.instanceKey}
            size="md"
            columns={columns}
            data={instances.data ?? []}
            empty={EMPTY_TEXT}
          />
        )}
      </Card>
    </Stack>
  );
}
