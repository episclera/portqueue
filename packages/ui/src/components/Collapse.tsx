import React from 'react';
import clsx from 'clsx';
import { CaretRightIcon } from '../icons';
import styles from './Collapse.module.css';

export interface CollapseItem {
  key: string;
  header: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}

export interface CollapseProps {
  items: CollapseItem[];
  defaultActiveKeys?: string[];
  multiple?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Accordion — clickable headers toggle panels; `multiple` allows several open at once. */
export function Collapse({
  items,
  defaultActiveKeys = [],
  multiple = false,
  className,
  style,
}: CollapseProps): React.ReactElement {
  const [activeKeys, setActiveKeys] = React.useState<string[]>(defaultActiveKeys);

  const toggle = (key: string): void => {
    setActiveKeys((prev) => {
      const isOpen = prev.includes(key);
      if (multiple) {
        return isOpen ? prev.filter((k) => k !== key) : [...prev, key];
      }
      return isOpen ? [] : [key];
    });
  };

  return (
    <div className={clsx(styles.root, className)} style={style}>
      {items.map((item) => {
        const open = activeKeys.includes(item.key);
        return (
          <div key={item.key} className={styles.panel}>
            <button
              className={styles.header}
              type="button"
              aria-expanded={open}
              onClick={() => toggle(item.key)}
            >
              <CaretRightIcon className={clsx(styles.indicator, open && styles.open)} aria-hidden />
              <span className={styles.headerLabel}>{item.header}</span>
              {item.extra !== undefined ? <span className={styles.extra}>{item.extra}</span> : null}
            </button>
            {open ? <div className={styles.body}>{item.children}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
