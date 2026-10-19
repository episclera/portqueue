import React from 'react';
import clsx from 'clsx';
import styles from './Timeline.module.css';

export interface TimelineItem {
  key: string;
  color?: string;
  dot?: React.ReactNode;
  label?: React.ReactNode;
  children: React.ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
}

/** Vertical timeline — coloured dots connected by a line, with optional labels and body content. */
export function Timeline({ items }: TimelineProps): React.ReactElement {
  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        <li key={item.key} className={clsx(styles.item, index === items.length - 1 && styles.last)}>
          <span
            className={styles.dot}
            style={item.color === undefined ? undefined : { background: item.color }}
            aria-hidden
          >
            {item.dot}
          </span>
          {item.label !== undefined ? <div className={styles.label}>{item.label}</div> : null}
          <div className={styles.body}>{item.children}</div>
        </li>
      ))}
    </ul>
  );
}
