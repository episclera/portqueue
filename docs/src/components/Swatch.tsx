import React from 'react';
import clsx from 'clsx';
import styles from './Swatch.module.css';

/**
 * Presentational swatch for the Brandbook page — a colour chip plus its token name, hex, and
 * usage note. Styled by a CSS Module against the shared palette CSS variables.
 */
export function Swatch({
  name,
  hex,
  note,
  dark = false,
}: {
  name: string;
  hex: string;
  note?: string;
  dark?: boolean;
}): React.ReactElement {
  return (
    <div className={styles.chip}>
      <div className={clsx(styles.sample, dark && styles.sampleDark)} style={{ background: hex }}>
        {hex}
      </div>
      <div className={styles.meta}>
        <code style={{ fontSize: 12 }}>{name}</code>
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>
    </div>
  );
}

/** Flex row wrapper for a set of swatches. */
export function SwatchRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className={styles.row}>{children}</div>;
}
