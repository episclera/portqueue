import React from 'react';
import clsx from 'clsx';
import styles from './Statistic.module.css';

export type StatisticTone = 'default' | 'brand' | 'success' | 'danger' | 'warning';

export interface StatisticProps {
  label: React.ReactNode;
  value: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  tone?: StatisticTone;
  /**
   * An explicit colour for the value, overriding `tone`. For palettes a tone can't express —
   * the per-status job colours, which are arbitrary hexes rather than semantic roles. Having it
   * here means callers never reach into this component's DOM to colour the number, which a
   * markup change would silently break.
   */
  valueColor?: string;
  /** Place the label below the value instead of above. */
  labelBelow?: boolean;
}

/** A big headline value with an uppercase label and optional prefix/suffix and tone colour. */
export function Statistic({
  label,
  value,
  prefix,
  suffix,
  tone = 'default',
  valueColor,
  labelBelow = false,
}: StatisticProps): React.ReactElement {
  return (
    <div className={clsx(styles.root, labelBelow && styles.below)}>
      <div className={styles.label}>{label}</div>
      <div
        className={clsx(styles.value, tone !== 'default' && styles[tone])}
        style={valueColor === undefined ? undefined : { color: valueColor }}
      >
        {prefix !== undefined ? <span className={styles.affix}>{prefix}</span> : null}
        <span>{value}</span>
        {suffix !== undefined ? <span className={styles.affix}>{suffix}</span> : null}
      </div>
    </div>
  );
}
