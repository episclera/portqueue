import React from 'react';
import clsx from 'clsx';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  circle?: boolean;
  radius?: number;
}

export interface SkeletonTextProps {
  rows?: number;
  width?: number | string;
}

const toDim = (v: number | string | undefined, fallback: string): string =>
  v === undefined ? fallback : typeof v === 'number' ? `${v}px` : v;

/** A single shimmering placeholder block; `circle` makes it round. */
export function Skeleton({
  width,
  height,
  circle = false,
  radius = 6,
}: SkeletonProps): React.ReactElement {
  return (
    <span
      className={clsx(styles.block, circle && styles.circle)}
      style={
        {
          '--pq-skeleton-width': toDim(width, circle ? '40px' : '100%'),
          '--pq-skeleton-height': toDim(height, circle ? '40px' : '16px'),
          '--pq-skeleton-radius': `${radius}px`,
        } as React.CSSProperties
      }
      aria-hidden
    />
  );
}

/** Several shimmering text lines; the last line is rendered shorter. */
export function SkeletonText({ rows = 3, width }: SkeletonTextProps): React.ReactElement {
  const count = Math.max(rows, 1);
  return (
    <div className={styles.text} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={12} width={i === count - 1 ? '60%' : toDim(width, '100%')} />
      ))}
    </div>
  );
}
