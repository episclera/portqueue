/**
 * Add-a-job form. The same modal creates a recurring definition when the mode is switched to
 * Recurring, mirroring core `addJob({ schedule })`. Supports clone pre-fill.
 *
 * Every field is validated before submitting, so a mistake is caught under the field rather than
 * round-tripping into a toast. Recurring mode in particular picks exactly one cadence from a
 * segmented control and shows only that field — the form once let both stay empty and quietly
 * created a plain one-off job while the button read "Create schedule".
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
import { ActionKind, type ActionResultDto, type AddJobRequestDto } from '../../shared/dto';
import { useAction } from '../queries/use-action';

export interface AddJobFormProps {
  open: boolean;
  queue: string;
  onClose: () => void;
  /** Prefill for clone: JSON string of data + optional priority. */
  initial?: { data?: unknown; priority?: number };
  /**
   * Called with the server's result once the job (or schedule) was created, after the modal has
   * closed. The caller decides what that means — a clone from a job's own page follows the new
   * record, a plain add from a queue page stays put.
   */
  onCreated?: (result: ActionResultDto) => void;
}

type Mode = 'once' | 'recurring';
/** Which cadence a recurring job uses. Exactly one, chosen explicitly. */
type Cadence = 'cron' | 'every';

/** Field-level messages, keyed by the field they belong under. */
type Errors = Partial<Record<'data' | 'cron' | 'every' | 'priority' | 'retry' | 'pattern', string>>;

/** The shortest interval worth scheduling; below this the scheduler poll dominates anyway. */
const MIN_INTERVAL_MS = 1000;

/**
 * A standard 5-field cron expression, validated well enough to catch typos client-side. Core
 * remains the authority — this only spares the user a round trip for an obviously malformed one.
 */
export function validateCron(expr: string): string | undefined {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `A cron expression has 5 fields (minute hour day month weekday); this has ${fields.length}.`;
  }
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  for (const [i, field] of fields.entries()) {
    const [min, max] = ranges[i]!;
    // Each field is a comma-separated list of `*`, `n`, or `a-b`, any of which may carry `/step`.
    for (const part of field.split(',')) {
      const [range, step] = part.split('/');
      if (step !== undefined && !/^\d+$/.test(step)) return `Invalid step '/${step}'.`;
      if (range === '*' || range === undefined || range === '') continue;
      const bounds = range.split('-');
      if (bounds.length > 2) return `Invalid range '${range}'.`;
      for (const bound of bounds) {
        if (!/^\d+$/.test(bound)) return `'${bound}' is not a number.`;
        const n = Number(bound);
        if (n < min || n > max) return `'${bound}' is outside the allowed range ${min}–${max}.`;
      }
    }
  }
  return undefined;
}

export function AddJobForm({
  open,
  queue,
  onClose,
  initial,
  onCreated,
}: AddJobFormProps): React.ReactElement {
  const { run } = useAction();
  const [mode, setMode] = useState<Mode>('once');
  const [cadence, setCadence] = useState<Cadence>('cron');
  const [submitting, setSubmitting] = useState(false);

  const initialData = initial?.data !== undefined ? JSON.stringify(initial.data, null, 2) : '{}';

  const [data, setData] = useState<string>(initialData);
  const [priority, setPriority] = useState<number | null>(initial?.priority ?? null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [singletonKey, setSingletonKey] = useState<string>('');
  const [retryMaxAttempts, setRetryMaxAttempts] = useState<number | null>(null);
  const [instancePattern, setInstancePattern] = useState<string>('');
  const [startAfter, setStartAfter] = useState<string>('');
  const [cron, setCron] = useState<string>('');
  const [everyMs, setEveryMs] = useState<number | null>(null);
  const [timezone, setTimezone] = useState<string>('');

  const [errors, setErrors] = useState<Errors>({});

  // Re-seed the controlled fields whenever the modal (re)opens with new clone data.
  useEffect(() => {
    if (!open) return;
    setData(initialData);
    setPriority(initial?.priority ?? null);
    setIdempotencyKey('');
    setSingletonKey('');
    setRetryMaxAttempts(null);
    setInstancePattern('');
    setStartAfter('');
    setCron('');
    setEveryMs(null);
    setTimezone('');
    setErrors({});
    setMode('once');
    setCadence('cron');
    // Deliberately keyed on `open` alone: reacting to every clone-prop identity change would
    // re-seed mid-edit and fight the user's typing.
  }, [open]);

  /** Validate everything at once, so the user sees every problem rather than one at a time. */
  const validate = (): { errors: Errors; parsed?: unknown } => {
    const next: Errors = {};
    let parsed: unknown;

    if (!data.trim()) {
      next.data = 'Data is required.';
    } else {
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        next.data = e instanceof Error ? e.message : 'Invalid JSON.';
      }
    }

    if (priority !== null && !Number.isInteger(priority)) {
      next.priority = 'Priority must be a whole number.';
    }
    if (retryMaxAttempts !== null && (!Number.isInteger(retryMaxAttempts) || retryMaxAttempts < 0)) {
      next.retry = 'Max attempts must be a whole number of 0 or more.';
    }
    if (instancePattern) {
      try {
        new RegExp(instancePattern);
      } catch (e) {
        next.pattern = e instanceof Error ? e.message : 'Not a valid regular expression.';
      }
    }

    if (mode === 'recurring') {
      if (cadence === 'cron') {
        if (!cron.trim()) next.cron = 'A cron expression is required for this cadence.';
        else next.cron = validateCron(cron);
      } else if (everyMs === null) {
        next.every = 'An interval is required for this cadence.';
      } else if (!Number.isInteger(everyMs) || everyMs < MIN_INTERVAL_MS) {
        next.every = `The interval must be a whole number of at least ${MIN_INTERVAL_MS}ms.`;
      }
    }

    // Drop keys that came back undefined, so "any errors?" is a plain emptiness check.
    for (const key of Object.keys(next) as (keyof Errors)[]) {
      if (next[key] === undefined) delete next[key];
    }
    return { errors: next, ...(parsed !== undefined ? { parsed } : {}) };
  };

  const submit = async (): Promise<void> => {
    const { errors: found, parsed } = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const add: AddJobRequestDto = {
      data: parsed,
      ...(typeof priority === 'number' ? { priority } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(singletonKey ? { singletonKey } : {}),
      ...(typeof retryMaxAttempts === 'number' ? { retryMaxAttempts } : {}),
      ...(instancePattern ? { preferredInstanceKeyPattern: instancePattern } : {}),
      ...(mode === 'once' && startAfter ? { startAfter } : {}),
      ...(mode === 'recurring' && cadence === 'cron'
        ? { cron: timezone ? { pattern: cron, tz: timezone } : cron }
        : {}),
      ...(mode === 'recurring' && cadence === 'every' && everyMs !== null
        ? { startEvery: everyMs }
        : {}),
    };

    setSubmitting(true);
    const result = await run(
      { kind: ActionKind.ADD, queue, add },
      mode === 'recurring' ? 'Schedule created' : 'Job added',
    );
    setSubmitting(false);
    if (!result) return;
    onClose();
    onCreated?.(result);
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
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { label: 'One-off', value: 'once' },
            { label: 'Recurring', value: 'recurring' },
          ]}
        />
        <Form onSubmit={(e) => e.preventDefault()}>
          <Field label="Data (JSON)" required error={errors.data} htmlFor="add-job-data">
            <Textarea
              id="add-job-data"
              rows={5}
              style={{ fontFamily: 'ui-monospace, monospace' }}
              invalid={errors.data !== undefined}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </Field>

          <Field
            label="Priority"
            hint="Higher runs first"
            error={errors.priority}
            htmlFor="add-job-priority"
          >
            <InputNumber
              id="add-job-priority"
              value={priority}
              onChange={setPriority}
              invalid={errors.priority !== undefined}
            />
          </Field>

          <Field
            label="Max retry attempts"
            hint="Leave empty to use the queue's default"
            error={errors.retry}
            htmlFor="add-job-retry"
          >
            <InputNumber
              id="add-job-retry"
              min={0}
              value={retryMaxAttempts}
              onChange={setRetryMaxAttempts}
              invalid={errors.retry !== undefined}
            />
          </Field>

          <Field label="Idempotency key" htmlFor="add-job-idempotency">
            <Input
              id="add-job-idempotency"
              placeholder="Optional; dedupes identical adds"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
            />
          </Field>

          <Field
            label="Singleton key"
            hint="At most one unfinished job may hold this key"
            htmlFor="add-job-singleton"
          >
            <Input
              id="add-job-singleton"
              placeholder="Optional"
              value={singletonKey}
              onChange={(e) => setSingletonKey(e.target.value)}
            />
          </Field>

          <Field
            label="Preferred instance pattern"
            hint="A regular expression matching the instance keys allowed to run this job"
            error={errors.pattern}
            htmlFor="add-job-instance"
          >
            <Input
              id="add-job-instance"
              placeholder="e.g. ^worker-eu-"
              invalid={errors.pattern !== undefined}
              value={instancePattern}
              onChange={(e) => setInstancePattern(e.target.value)}
            />
          </Field>

          {mode === 'once' ? (
            <Field
              label="Start after"
              hint="Optional delay — a duration like '30s' or an ISO date"
              htmlFor="add-job-start-after"
            >
              <Input
                id="add-job-start-after"
                placeholder="e.g. 30s, 5m, 2026-01-01T00:00:00Z"
                value={startAfter}
                onChange={(e) => setStartAfter(e.target.value)}
              />
            </Field>
          ) : (
            <>
              {/* One cadence, picked explicitly, and only the chosen field is rendered — so
                  "recurring with neither filled in" is not a state this form can reach. */}
              <Field label="Cadence">
                <Segmented<Cadence>
                  size="sm"
                  value={cadence}
                  onChange={setCadence}
                  options={[
                    { label: 'Cron expression', value: 'cron' },
                    { label: 'Fixed interval', value: 'every' },
                  ]}
                />
              </Field>

              {cadence === 'cron' ? (
                <>
                  <Field
                    label="Cron expression"
                    required
                    error={errors.cron}
                    hint="Five fields: minute hour day month weekday"
                    htmlFor="add-job-cron"
                  >
                    <Input
                      id="add-job-cron"
                      placeholder="e.g. 0 * * * *"
                      invalid={errors.cron !== undefined}
                      value={cron}
                      onChange={(e) => setCron(e.target.value)}
                    />
                  </Field>
                  <Field label="Timezone" htmlFor="add-job-tz">
                    <Input
                      id="add-job-tz"
                      placeholder="IANA tz, e.g. UTC"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <Field label="Every (ms)" required error={errors.every} htmlFor="add-job-every">
                  <InputNumber
                    id="add-job-every"
                    min={MIN_INTERVAL_MS}
                    value={everyMs}
                    onChange={setEveryMs}
                    placeholder="e.g. 60000"
                    invalid={errors.every !== undefined}
                  />
                </Field>
              )}
            </>
          )}
        </Form>

        {errors.data ? <Alert type="error" showIcon message={errors.data} /> : null}
      </Stack>
    </Modal>
  );
}
