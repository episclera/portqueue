import React from 'react';
import clsx from 'clsx';
import { Portal } from '../overlay/Portal';
import { useAnchoredLayer } from '../overlay/useAnchoredLayer';
import { useDismiss } from '../overlay/useDismiss';
import styles from './Dropdown.module.css';

export interface DropdownItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface DropdownProps {
  items: DropdownItem[];
  children: React.ReactElement;
  align?: 'left' | 'right';
  className?: string;
}

/** Kept in step with `.menu`'s `min-width` in the module. */
const MIN_WIDTH = 180;

/** Bespoke dropdown menu, portalled to the body and anchored to its trigger child. */
export const Dropdown = ({
  items,
  children,
  align = 'left',
  className,
}: DropdownProps): React.ReactElement => {
  const [open, setOpen] = React.useState(false);
  const { triggerRef, layerRef, position } = useAnchoredLayer<HTMLSpanElement, HTMLDivElement>({
    open,
    align: align === 'right' ? 'end' : 'start',
    minWidth: MIN_WIDTH,
  });

  useDismiss({ open, onDismiss: () => setOpen(false), refs: [triggerRef, layerRef] });

  const handleItemClick = (item: DropdownItem): void => {
    if (item.disabled) return;
    setOpen(false);
    item.onClick?.();
  };

  const trigger = React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e);
      setOpen((prev) => !prev);
    },
  });

  return (
    <>
      <span ref={triggerRef} className={clsx(styles.wrapper, className)}>
        {trigger}
      </span>
      {open && position ? (
        <Portal>
          <div
            ref={layerRef}
            className={styles.menu}
            role="menu"
            style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                className={clsx(styles.item, item.danger && styles.danger)}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
              >
                {item.icon != null ? (
                  <span className={styles.itemIcon} aria-hidden>
                    {item.icon}
                  </span>
                ) : null}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </Portal>
      ) : null}
    </>
  );
};
