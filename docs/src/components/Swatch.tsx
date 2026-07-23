import React from 'react';
import styled from 'styled-components';

const Chip = styled.div`
  border: 1px solid var(--secondary);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface);
  min-width: 180px;
  flex: 1 1 180px;
`;

const Sample = styled.div<{ $hex: string; $dark: boolean }>`
  background: ${(p) => p.$hex};
  height: 72px;
  display: flex;
  align-items: flex-end;
  padding: 8px;
  color: ${(p) => (p.$dark ? '#EDEFEC' : '#1B1F1D')};
  font-family: var(--ifm-font-family-monospace);
  font-size: 12px;
`;

const Meta = styled.div`
  padding: 8px 10px;
`;

const Note = styled.p`
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--text-muted);
`;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px 0 24px;
`;

/**
 * Presentational swatch for the Brandbook page — a colour chip plus its token name, hex, and
 * usage note. Styled with styled-components against the shared palette CSS variables.
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
    <Chip>
      <Sample $hex={hex} $dark={dark}>
        {hex}
      </Sample>
      <Meta>
        <code style={{ fontSize: 12 }}>{name}</code>
        {note ? <Note>{note}</Note> : null}
      </Meta>
    </Chip>
  );
}

/** Flex row wrapper for a set of swatches. */
export function SwatchRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Row>{children}</Row>;
}
