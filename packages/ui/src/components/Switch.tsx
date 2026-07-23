import React from 'react';
import styled from 'styled-components';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

const Track = styled.button<{ $checked: boolean; $size: 'sm' | 'md' }>`
  position: relative;
  flex: 0 0 auto;
  width: ${(p) => (p.$size === 'sm' ? 34 : 44)}px;
  height: ${(p) => (p.$size === 'sm' ? 18 : 24)}px;
  border: none;
  padding: 0;
  border-radius: 999px;
  cursor: ${(p) => (p.disabled ? 'not-allowed' : 'pointer')};
  background: ${(p) => (p.$checked ? p.theme.color.brand : p.theme.color.borderStrong)};
  opacity: ${(p) => (p.disabled ? 0.55 : 1)};
  transition: background ${(p) => p.theme.motion.fast};
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.brand};
    outline-offset: 2px;
  }
`;

const Knob = styled.span<{ $checked: boolean; $size: 'sm' | 'md' }>`
  position: absolute;
  top: 2px;
  left: 2px;
  width: ${(p) => (p.$size === 'sm' ? 14 : 20)}px;
  height: ${(p) => (p.$size === 'sm' ? 14 : 20)}px;
  border-radius: 50%;
  background: #fff;
  box-shadow: ${(p) => p.theme.shadow.sm};
  transform: translateX(${(p) => (p.$checked ? (p.$size === 'sm' ? 16 : 20) : 0)}px);
  transition: transform ${(p) => p.theme.motion.fast};
`;

/** Toggle switch. */
export function Switch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  'aria-label': ariaLabel,
}: SwitchProps): React.ReactElement {
  return (
    <Track
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      $checked={checked}
      $size={size}
      onClick={() => !disabled && onChange(!checked)}
    >
      <Knob $checked={checked} $size={size} aria-hidden />
    </Track>
  );
}
