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
import { Button, Inline, Modal, Select, Stack, Text } from '@portqueue/ui';
import styles from './FiltersModal.module.css';

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

  // Re-seed whenever the dialog opens *or* the applied values change while it is open — a chip
  // dismissed in the toolbar behind the dialog must not leave the draft holding a stale filter.
  // `serialized` compares by content: `values` is a fresh object every render, so depending on
  // the object itself would re-seed on each keystroke and fight the user's edits.
  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (open) setDraft(seed(values));
    // `serialized` stands in for `values` here, deliberately: `values` is a fresh object every
    // render, so depending on it directly would re-seed constantly and fight the user's edits.
  }, [open, serialized]);

  const footer = (
    <Inline gap={2} justify="space-between" style={{ width: '100%' }}>
      <Button variant="text" onClick={() => setDraft({})}>
        Clear all
      </Button>
      <Inline gap={2}>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply filters
        </Button>
      </Inline>
    </Inline>
  );

  return (
    <Modal open={open} onClose={onClose} title="Filters" footer={footer}>
      <Stack gap={5}>
        {defs.length === 0 ? <Text tone="muted">No filters available.</Text> : null}
        {defs.map((def) => (
          <fieldset key={def.key} className={styles.group}>
            <legend className={styles.groupLabel}>{def.label}</legend>
            <Select<string>
              block
              value={draft[def.key]?.[0] ?? ANY}
              onChange={(value) =>
                setDraft((prev) => ({ ...prev, [def.key]: value === ANY ? [] : [value] }))
              }
              options={[
                { label: 'Any', value: ANY },
                ...def.options.map((o) => ({ label: o.label, value: o.value })),
              ]}
            />
          </fieldset>
        ))}
      </Stack>
    </Modal>
  );
}
