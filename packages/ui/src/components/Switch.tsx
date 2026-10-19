import React from 'react';
import clsx from 'clsx';
import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

/** Toggle switch. */
export function Switch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  'aria-label': ariaLabel,
}: SwitchProps): React.ReactElement {
  return (
    <button
      className={clsx(styles.track, size === 'sm' && styles.sm, checked && styles.checked)}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className={styles.knob} aria-hidden />
    </button>
  );
}
