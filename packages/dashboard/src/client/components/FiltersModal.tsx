/**
 * Filters dialog for a table. A table declares its filters (a key, a label and the options);
 * this renders the pickers, and the applied values are written to the URL by the caller.
 */
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Checkbox, Inline, Modal, Select, Stack, Text } from '@portqueue/ui';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterDef {
  key: string;
  label: string;
  options: FilterOption[];
  /** Multi-select filters render a checkbox list; single ones a select. */
  multiple?: boolean;
}

export interface FiltersModalProps {
  open: boolean;
  onClose: () => void;
  defs: FilterDef[];
  values: Record<string, string[] | undefined>;
  onApply: (values: Record<string, string[]>) => void;
}

const Group = styled.fieldset`
  margin: 0;
  padding: 0;
  border: none;
`;

const GroupLabel = styled.legend`
  padding: 0;
  margin-bottom: ${(p) => p.theme.space(2)};
  font-size: 13px;
  font-weight: 600;
  color: ${(p) => p.theme.color.text};
`;

const CheckList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: ${(p) => p.theme.space(2)};
`;

const CheckRow = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  font-size: 13.5px;
  cursor: pointer;
`;

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

  // Re-seed from the applied values every time the dialog opens.
  useEffect(() => {
    if (open) setDraft(seed(values));
  }, [open]);

  const toggle = (key: string, value: string): void => {
    setDraft((prev) => {
      const current = prev[key] ?? [];
      return {
        ...prev,
        [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
      };
    });
  };

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
        {defs.length === 0 ? <Text $tone="muted">No filters available.</Text> : null}
        {defs.map((def) => (
          <Group key={def.key}>
            <GroupLabel>{def.label}</GroupLabel>
            {def.multiple ? (
              <CheckList>
                {def.options.map((option) => (
                  <CheckRow key={option.value}>
                    <Checkbox
                      checked={(draft[def.key] ?? []).includes(option.value)}
                      onChange={() => toggle(def.key, option.value)}
                    />
                    <span>{option.label}</span>
                  </CheckRow>
                ))}
              </CheckList>
            ) : (
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
            )}
          </Group>
        ))}
      </Stack>
    </Modal>
  );
}
