/**
 * Add-a-job form. The same modal creates a recurring definition when the
 * schedule fields are filled, mirroring core `addJob({ schedule })`. Supports clone pre-fill.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Field,
  Form,
  Inline,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Stack,
  Textarea,
} from '@portqueue/ui';
import { useAction } from '../queries/use-action.js';
import type { ActionRequestDto } from '../../shared/dto.js';

export interface AddJobFormProps {
  open: boolean;
  queue: string;
  onClose: () => void;
  /** Prefill for clone: JSON string of data + optional priority. */
  initial?: { data?: unknown; priority?: number };
}

export function AddJobForm({ open, queue, onClose, initial }: AddJobFormProps): React.ReactElement {
  const { run } = useAction();
  const [mode, setMode] = useState<'once' | 'recurring'>('once');
  const [submitting, setSubmitting] = useState(false);

  const initialData = initial?.data !== undefined ? JSON.stringify(initial.data, null, 2) : '{}';

  const [data, setData] = useState<string>(initialData);
  const [priority, setPriority] = useState<number | null>(initial?.priority ?? null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [cron, setCron] = useState<string>('');
  const [everyMs, setEveryMs] = useState<number | null>(null);
  const [timezone, setTimezone] = useState<string>('');

  // Inline "required" validation (mirrors antd Form.Item `required` rule).
  const [requiredError, setRequiredError] = useState<string | undefined>(undefined);
  // JSON parse failure, surfaced as a banner (mirrors the original standalone Alert).
  const [jsonError, setJsonError] = useState<string | undefined>(undefined);

  // Re-seed the controlled fields whenever the modal (re)opens with new clone data.
  useEffect(() => {
    if (!open) return;
    setData(initialData);
    setPriority(initial?.priority ?? null);
    setIdempotencyKey('');
    setCron('');
    setEveryMs(null);
    setTimezone('');
    setRequiredError(undefined);
    setJsonError(undefined);
    setMode('once');
  }, [open]);

  const submit = async (): Promise<void> => {
    // Required: data. Then it must parse as JSON.
    if (!data.trim()) {
      setRequiredError('Data is required');
      return;
    }
    setRequiredError(undefined);
    let parsed: unknown;
    try {
      parsed = JSON.parse(data || '{}');
      setJsonError(undefined);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    const body: ActionRequestDto = {
      kind: 'add',
      queue,
      add: {
        data: parsed,
        ...(typeof priority === 'number' ? { priority } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(mode === 'recurring' && cron
          ? { cron: timezone ? { pattern: cron, tz: timezone } : cron }
          : {}),
        ...(mode === 'recurring' && !cron && typeof everyMs === 'number'
          ? { startEvery: everyMs }
          : {}),
      },
    };
    setSubmitting(true);
    const ok = await run(body, mode === 'recurring' ? 'Schedule created' : 'Job added');
    setSubmitting(false);
    if (ok) onClose();
  };

  const footer = (
    <Inline gap={2} justify="flex-end">
      <Button variant="text" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" loading={submitting} onClick={() => void submit()}>
        {mode === 'recurring' ? 'Create schedule' : 'Add job'}
      </Button>
    </Inline>
  );

  return (
    <Modal title={`Add job to “${queue}”`} open={open} onClose={onClose} footer={footer}>
      <Stack gap={4}>
        <Segmented<'once' | 'recurring'>
          value={mode}
          onChange={setMode}
          options={[
            { label: 'One-off', value: 'once' },
            { label: 'Recurring', value: 'recurring' },
          ]}
        />
        <Form onSubmit={(e) => e.preventDefault()}>
          <Field label="Data (JSON)" required error={requiredError} htmlFor="add-job-data">
            <Textarea
              id="add-job-data"
              rows={5}
              style={{ fontFamily: 'ui-monospace, monospace' }}
              invalid={requiredError !== undefined || jsonError !== undefined}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </Field>
          <Field label="Priority" htmlFor="add-job-priority">
            <InputNumber value={priority} onChange={setPriority} />
          </Field>
          <Field label="Idempotency key" htmlFor="add-job-idempotency">
            <Input
              id="add-job-idempotency"
              placeholder="Optional; dedupes identical adds"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
            />
          </Field>
          {mode === 'recurring' && (
            <>
              <Field
                label="Cron expression"
                hint="Provide either cron or interval"
                htmlFor="add-job-cron"
              >
                <Input
                  id="add-job-cron"
                  placeholder="e.g. 0 * * * *"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                />
              </Field>
              <Field label="Every (ms)" htmlFor="add-job-every">
                <InputNumber value={everyMs} onChange={setEveryMs} placeholder="e.g. 60000" />
              </Field>
              <Field label="Timezone" htmlFor="add-job-tz">
                <Input
                  id="add-job-tz"
                  placeholder="IANA tz, e.g. UTC (cron only)"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                />
              </Field>
            </>
          )}
        </Form>
        {jsonError && <Alert type="error" showIcon message={jsonError} />}
      </Stack>
    </Modal>
  );
}
