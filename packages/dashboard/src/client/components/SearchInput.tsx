/** Search box with the magnifier inside the field. Debounced so typing doesn't spam the URL. */
import React, { useEffect, useState } from 'react';
import { CloseIcon, Input, SearchIcon } from '@portqueue/ui';
import styles from './SearchInput.module.css';

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
    <div className={styles.wrapper}>
      <SearchIcon className={styles.icon} aria-hidden />
      <Input
        className={styles.field}
        inputSize="sm"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setDraft(e.target.value)}
      />
      {draft ? (
        <button
          className={styles.clear}
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
        >
          <CloseIcon aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
