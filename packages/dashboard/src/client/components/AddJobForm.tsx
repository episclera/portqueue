/**
 * Add-a-job form. The same modal creates a recurring definition when the
 * schedule fields are filled, mirroring core `addJob({ schedule })`. Supports clone pre-fill.
 */
import React, { useState } from 'react';
import { Alert, Form, Input, InputNumber, Modal, Segmented, Space } from 'antd';
import { useAction } from '../queries/use-action.js';
import type { ActionRequestDto } from '../../shared/dto.js';

export interface AddJobFormProps {
  open: boolean;
  queue: string;
  onClose: () => void;
  /** Prefill for clone: JSON string of data + optional priority. */
  initial?: { data?: unknown; priority?: number };
}

interface FormValues {
  data: string;
  priority?: number;
  idempotencyKey?: string;
  cron?: string;
  everyMs?: number;
  timezone?: string;
}

export function AddJobForm({ open, queue, onClose, initial }: AddJobFormProps): React.ReactElement {
  const [form] = Form.useForm<FormValues>();
  const { run } = useAction();
  const [mode, setMode] = useState<'once' | 'recurring'>('once');
  const [submitting, setSubmitting] = useState(false);
  const [jsonError, setJsonError] = useState<string | undefined>(undefined);

  const initialData = initial?.data !== undefined ? JSON.stringify(initial.data, null, 2) : '{}';

  const submit = async (): Promise<void> => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(values.data || '{}');
      setJsonError(undefined);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    const body: ActionRequestDto = {
      kind: 'add',
      queue,
      add: {
        data,
        ...(typeof values.priority === 'number' ? { priority: values.priority } : {}),
        ...(values.idempotencyKey ? { idempotencyKey: values.idempotencyKey } : {}),
        ...(mode === 'recurring' && values.cron
          ? {
              cron: values.timezone
                ? { pattern: values.cron, tz: values.timezone }
                : values.cron,
            }
          : {}),
        ...(mode === 'recurring' && !values.cron && typeof values.everyMs === 'number'
          ? { startEvery: values.everyMs }
          : {}),
      },
    };
    setSubmitting(true);
    const ok = await run(body, mode === 'recurring' ? 'Schedule created' : 'Job added');
    setSubmitting(false);
    if (ok) {
      form.resetFields();
      onClose();
    }
  };

  return (
    <Modal
      title={`Add job to “${queue}”`}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={mode === 'recurring' ? 'Create schedule' : 'Add job'}
      confirmLoading={submitting}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Segmented
          block
          value={mode}
          onChange={(v) => setMode(v as 'once' | 'recurring')}
          options={[
            { label: 'One-off', value: 'once' },
            { label: 'Recurring', value: 'recurring' },
          ]}
        />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ data: initialData, priority: initial?.priority }}
        >
          <Form.Item label="Data (JSON)" name="data" rules={[{ required: true }]}>
            <Input.TextArea rows={5} style={{ fontFamily: 'ui-monospace, monospace' }} />
          </Form.Item>
          {jsonError && (
            <Alert type="error" showIcon message={jsonError} style={{ marginBottom: 12 }} />
          )}
          <Form.Item label="Priority" name="priority">
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Idempotency key" name="idempotencyKey">
            <Input placeholder="Optional; dedupes identical adds" />
          </Form.Item>
          {mode === 'recurring' && (
            <>
              <Form.Item
                label="Cron expression"
                name="cron"
                tooltip="Provide either cron or interval"
              >
                <Input placeholder="e.g. 0 * * * *" />
              </Form.Item>
              <Form.Item label="Every (ms)" name="everyMs">
                <InputNumber style={{ width: '100%' }} placeholder="e.g. 60000" />
              </Form.Item>
              <Form.Item label="Timezone" name="timezone">
                <Input placeholder="IANA tz, e.g. UTC (cron only)" />
              </Form.Item>
            </>
          )}
        </Form>
      </Space>
    </Modal>
  );
}
