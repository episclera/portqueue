import React from 'react';
import styled, { keyframes } from 'styled-components';

export interface DropdownItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface DropdownProps {
  items: DropdownItem[];
  children: React.ReactElement;
  align?: 'left' | 'right';
}

const popIn = keyframes`
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const Wrapper = styled.span`
  position: relative;
  display: inline-block;
`;

const Menu = styled.div<{ $align: 'left' | 'right' }>`
  position: absolute;
  top: 100%;
  ${(p) => (p.$align === 'right' ? 'right: 0;' : 'left: 0;')}
  z-index: ${(p) => p.theme.zIndex.modal};
  min-width: 180px;
  margin-top: 6px;
  padding: ${(p) => p.theme.space(1)};
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  box-shadow: ${(p) => p.theme.shadow.lg};
  animation: ${popIn} ${(p) => p.theme.motion.fast};
`;

const MenuItem = styled.button<{ $danger: boolean }>`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  width: 100%;
  padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  color: ${(p) => (p.$danger ? p.theme.color.danger : p.theme.color.text)};
  background: transparent;
  border: none;
  border-radius: ${(p) => p.theme.radii.sm}px;
  cursor: pointer;
  transition: background ${(p) => p.theme.motion.fast};
  &:hover:not(:disabled) {
    background: ${(p) => (p.$danger ? `${p.theme.color.danger}14` : p.theme.color.surfaceAlt)};
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.brand};
    outline-offset: -2px;
  }
`;

const ItemIcon = styled.span`
  display: inline-flex;
  width: 16px;
  justify-content: center;
`;

/** Bespoke dropdown menu anchored to its trigger child. */
export const Dropdown = ({ items, children, align = 'left' }: DropdownProps): React.ReactElement => {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleItemClick = (item: DropdownItem): void => {
    if (item.disabled) return;
    setOpen(false);
    item.onClick?.();
  };

  const trigger = React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e);
      setOpen((prev) => !prev);
    },
  });

  return (
    <Wrapper ref={wrapperRef}>
      {trigger}
      {open ? (
        <Menu $align={align} role="menu">
          {items.map((item) => (
            <MenuItem
              key={item.key}
              type="button"
              role="menuitem"
              $danger={item.danger ?? false}
              disabled={item.disabled}
              onClick={() => handleItemClick(item)}
            >
              {item.icon != null ? <ItemIcon aria-hidden>{item.icon}</ItemIcon> : null}
              <span>{item.label}</span>
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </Wrapper>
  );
};
