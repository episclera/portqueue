import React from 'react';
import styled, { css } from 'styled-components';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  title: React.ReactNode;
  placement?: TooltipPlacement;
  children: React.ReactElement;
}

const Wrapper = styled.span`
  position: relative;
  display: inline-flex;
`;

const placementStyles = (placement: TooltipPlacement) =>
  ({
    top: css`
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-bottom: 6px;
    `,
    bottom: css`
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-top: 6px;
    `,
    left: css`
      right: 100%;
      top: 50%;
      transform: translateY(-50%);
      margin-right: 6px;
    `,
    right: css`
      left: 100%;
      top: 50%;
      transform: translateY(-50%);
      margin-left: 6px;
    `,
  })[placement];

const Bubble = styled.span<{ $placement: TooltipPlacement }>`
  position: absolute;
  z-index: ${(p) => p.theme.zIndex.toast};
  max-width: 240px;
  padding: 5px 9px;
  font-size: 12.5px;
  line-height: 1.4;
  font-weight: 500;
  white-space: normal;
  color: #ffffff;
  background: #1f2530;
  border-radius: ${(p) => p.theme.radii.sm}px;
  box-shadow: ${(p) => p.theme.shadow.md};
  pointer-events: none;
  ${(p) => placementStyles(p.$placement)}
`;

/** Bespoke tooltip — shows a dark bubble on hover/focus of its single child. */
export const Tooltip = ({ title, placement = 'top', children }: TooltipProps): React.ReactElement => {
  const [visible, setVisible] = React.useState(false);

  const show = (): void => setVisible(true);
  const hide = (): void => setVisible(false);

  return (
    <Wrapper
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible ? (
        <Bubble $placement={placement} role="tooltip">
          {title}
        </Bubble>
      ) : null}
    </Wrapper>
  );
};
