import React from 'react';
import styled, { keyframes } from 'styled-components';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Outer diameter in px. Defaults to 20. */
  size?: number;
}

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const Ring = styled.span<{ $size: number }>`
  display: inline-block;
  box-sizing: border-box;
  width: ${(p) => p.$size}px;
  height: ${(p) => p.$size}px;
  border: ${(p) => Math.max(2, Math.round(p.$size / 10))}px solid ${(p) => p.theme.color.border};
  border-top-color: ${(p) => p.theme.color.brand};
  border-radius: ${(p) => p.theme.radii.pill}px;
  animation: ${spin} 720ms linear infinite;
`;

/** CSS spinner ring — brand-coloured top segment rotating over a muted border. */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 20, ...rest },
  ref,
): React.ReactElement {
  return <Ring ref={ref} $size={size} role="status" aria-label="Loading" {...rest} />;
});
