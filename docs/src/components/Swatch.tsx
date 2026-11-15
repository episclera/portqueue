import React from 'react';
import { tokens } from '@portqueue/theme';
import styles from './Swatch.module.css';

/**
 * Presentational swatch for the Brandbook page — a colour chip plus its token name, hex, and
 * usage note. Styled by a CSS Module against the shared `--pq-*` variables; the label on the chip
 * takes the light or dark theme's text colour from `@portqueue/theme`, whichever reads on `hex`.
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
      <div
        className={styles.sample}
        style={{ background: hex, color: (dark ? tokens.modes.dark : tokens.modes.light).text }}
      >
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
