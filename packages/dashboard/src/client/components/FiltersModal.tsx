/**
 * Filters dialog for a table. A table declares its filters (a key, a label and the options); this
 * renders one select per filter, and the applied values are written to the URL by the caller.
 *
 * Every filter picks a single value. A filter is a question with one answer — "show me the failed
 * ones" — and a select says which answer is in force at a glance, where a grid of checkboxes made
 * "three of eight statuses ticked" a state you had to read twice. The URL still carries a
 * comma-separated list, so a hand-written link with several values keeps working.
 */
import React, { useEffect, useState } from 'react';
import { Button, Flex, Form, Modal, Select, Typography } from 'antd';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
}

export interface FiltersModalProps {
  open: boolean;
  onClose: () => void;
  defs: FilterDef[];
  values: Record<string, string[] | undefined>;
  onApply: (values: Record<string, string[]>) => void;
}

const ANY = '__any';

/** Drop the absent keys so the editing draft is a plain key → values map. */
function seed(values: Record<string, string[] | undefined>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(values)) if (list?.length) out[key] = list;
  return out;
}

export function FiltersModal({
  open,
  onClose,
  defs,
  values,
  onApply,
}: FiltersModalProps): React.ReactElement {
  const [draft, setDraft] = useState<Record<string, string[]>>(() => seed(values));

  // Re-seed whenever the dialog opens *or* the applied values change while it is open — a tag
  // dismissed in the toolbar behind the dialog must not leave the draft holding a stale filter.
  // `serialized` stands in for `values`, deliberately: `values` is a fresh object every render, so
  // depending on it directly would re-seed constantly and fight the user's edits.
  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (open) setDraft(seed(values));
  }, [open, serialized]);

  const footer = (
    <Flex justify="space-between" gap="small">
      <Button type="text" onClick={() => setDraft({})}>
        Clear all
      </Button>
      <Flex gap="small">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply filters
        </Button>
      </Flex>
    </Flex>
  );

  return (
    <Modal open={open} onCancel={onClose} title="Filters" footer={footer} destroyOnHidden>
      {defs.length === 0 ? (
        <Typography.Text type="secondary">No filters available.</Typography.Text>
      ) : null}
      <Form layout="vertical" component="div">
        {defs.map((def) => (
          <Form.Item key={def.key} label={def.label} htmlFor={`filter-${def.key}`}>
            <Select<string>
              id={`filter-${def.key}`}
              value={draft[def.key]?.[0] ?? ANY}
              onChange={(value) =>
                setDraft((prev) => ({ ...prev, [def.key]: value === ANY ? [] : [value] }))
              }
              options={[
                { label: 'Any', value: ANY },
                ...def.options.map((o) => ({ label: o.label, value: o.value })),
              ]}
            />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}
