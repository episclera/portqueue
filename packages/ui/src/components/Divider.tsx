import React from 'react';
import styled, { css } from 'styled-components';

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  vertical?: boolean;
  /** Optional centered label — only shown on horizontal dividers. */
  label?: React.ReactNode;
}

const HRule = styled.div<{ $labelled: boolean }>`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(3)};
  width: 100%;
  color: ${(p) => p.theme.color.textMuted};
  font-size: 13px;

  ${(p) =>
    p.$labelled
      ? css`
          &::before,
          &::after {
            content: '';
            flex: 1;
            height: 1px;
            background: ${p.theme.color.border};
          }
        `
      : css`
          height: 1px;
          background: ${p.theme.color.border};
        `}
`;

const VRule = styled.div`
  display: inline-block;
  align-self: stretch;
  width: 1px;
  min-height: 1em;
  background: ${(p) => p.theme.color.border};
`;

/** Bespoke divider — a horizontal rule (optionally with a centered label) or a vertical rule. */
export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(function Divider(
  { vertical = false, label, ...rest },
  ref,
): React.ReactElement {
  if (vertical) {
    return <VRule ref={ref} role="separator" aria-orientation="vertical" {...rest} />;
  }
  return (
    <HRule ref={ref} role="separator" $labelled={label != null} {...rest}>
      {label != null ? <span>{label}</span> : null}
    </HRule>
  );
});
