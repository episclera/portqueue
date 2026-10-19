import clsx from 'clsx';
import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  label: React.ReactNode;
  value: T;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
}

/** Segmented single-select control (theme switcher, small filters). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: SegmentedProps<T>): React.ReactElement {
  return (
    <div className={clsx(styles.track, size === 'sm' && styles.sm)} role="tablist">
      {options.map((o) => (
        <button
          className={clsx(styles.segment, o.value === value && styles.active)}
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
