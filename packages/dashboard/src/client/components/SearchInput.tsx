/** Search box with the magnifier inside the field. Debounced so typing doesn't spam the URL. */
import React, { useEffect, useState } from 'react';
import { Input } from 'antd';
import { SearchIcon } from '../icons';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** How long to wait after the last keystroke before pushing the term into the URL. */
const DEBOUNCE_MS = 300;

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
    <Input
      allowClear
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      prefix={<SearchIcon aria-hidden />}
      style={{ width: 280 }}
      onChange={(e) => {
        setDraft(e.target.value);
        // Clearing is not typing: an emptied box (the clear button, or the last backspace) takes
        // effect at once rather than after the debounce.
        if (!e.target.value) onChange('');
      }}
    />
  );
}
