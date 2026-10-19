import React from 'react';
import clsx from 'clsx';
import { Portal } from '../overlay/Portal';
import { useAnchoredLayer } from '../overlay/useAnchoredLayer';
import { useDismiss } from '../overlay/useDismiss';
import { CaretDownIcon, CheckIcon } from '../icons';
import styles from './Select.module.css';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption<T extends string | number> {
  label: React.ReactNode;
  value: T;
}

export interface SelectProps<T extends string | number> {
  value: T | undefined;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: React.ReactNode;
  disabled?: boolean;
  block?: boolean;
  size?: SelectSize;
  className?: string;
  style?: React.CSSProperties;
}

/** Preferred menu height; shrinks further when the viewport leaves less room. */
const MAX_MENU_HEIGHT = 260;

/** Bespoke custom-control select — no native `<select>`; keyboard + outside-click aware. */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  block = false,
  size = 'md',
  className,
  style,
}: SelectProps<T>): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const { triggerRef, layerRef, position } = useAnchoredLayer<HTMLDivElement, HTMLUListElement>({
    open,
    align: 'stretch',
    gap: 4,
  });

  const selected = options.find((option) => option.value === value);

  useDismiss({ open, onDismiss: () => setOpen(false), refs: [triggerRef, layerRef] });

  const handleSelect = (next: T): void => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div
      ref={triggerRef}
      className={clsx(styles.wrapper, block && styles.block, className)}
      style={style}
    >
      <button
        type="button"
        className={clsx(
          styles.trigger,
          size !== 'md' && styles[size],
          open && styles.open,
          selected === undefined && styles.placeholder,
        )}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.label}>{selected ? selected.label : placeholder}</span>
        <CaretDownIcon className={clsx(styles.caret, open && styles.caretOpen)} aria-hidden />
      </button>
      {open && position ? (
        <Portal>
          <ul
            ref={layerRef}
            role="listbox"
            className={styles.menu}
            style={{
              top: position.top,
              left: position.left,
              width: position.width ?? 0,
              maxHeight: Math.min(MAX_MENU_HEIGHT, position.maxHeight),
            }}
          >
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <li
                  className={clsx(styles.item, isSelected && styles.selected)}
                  key={String(option.value)}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.value)}
                >
                  <span>{option.label}</span>
                  {isSelected ? <CheckIcon aria-hidden /> : null}
                </li>
              );
            })}
          </ul>
        </Portal>
      ) : null}
    </div>
  );
}
