/** Search box with the magnifier inside the field. Debounced so typing doesn't spam the URL. */
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Input } from '@portqueue/ui';
import { ACTIONS_CONFIG } from '../constants/labels';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** How long to wait after the last keystroke before pushing the term into the URL. */
const DEBOUNCE_MS = 300;

const Wrapper = styled.div`
  position: relative;
  width: 220px;
  max-width: 100%;
`;

const Icon = styled.span`
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  font-size: 12px;
  line-height: 1;
  opacity: 0.6;
  pointer-events: none;
`;

/** The magnifier sits inside the field, so the input needs room for it. */
const Field = styled(Input)`
  padding-left: 30px;
`;

const Clear = styled.button`
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 11px;
  color: ${(p) => p.theme.color.textMuted};
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
    color: ${(p) => p.theme.color.text};
  }
`;

export function SearchInput({
  value,
  onChange,
  placeholder,
}: SearchInputProps): React.ReactElement {
  const [draft, setDraft] = useState(value);

  // Adopt external changes (back/forward, filters cleared) without fighting the user's typing.
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <Wrapper>
      <Icon aria-hidden>{ACTIONS_CONFIG.search.icon}</Icon>
      <Field
        inputSize="sm"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setDraft(e.target.value)}
      />
      {draft ? (
        <Clear
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
        >
          ✕
        </Clear>
      ) : null}
    </Wrapper>
  );
}
