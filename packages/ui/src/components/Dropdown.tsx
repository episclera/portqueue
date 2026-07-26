import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Portal } from '../overlay/Portal';
import { useAnchoredLayer } from '../overlay/useAnchoredLayer';
import { useDismiss } from '../overlay/useDismiss';

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
  display: inline-block;
`;

const MIN_WIDTH = 180;

/**
 * Rendered in a body portal at fixed viewport coordinates, so a toolbar or table cell with
 * `overflow: hidden` can't clip the menu and no ancestor stacking context can bury it.
 */
const Menu = styled.div<{ $top: number; $left: number; $maxHeight: number }>`
  position: fixed;
  top: ${(p) => p.$top}px;
  left: ${(p) => p.$left}px;
  z-index: ${(p) => p.theme.zIndex.dropdown};
  min-width: ${MIN_WIDTH}px;
  max-height: ${(p) => p.$maxHeight}px;
  overflow-y: auto;
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

/** Bespoke dropdown menu, portalled to the body and anchored to its trigger child. */
export const Dropdown = ({
  items,
  children,
  align = 'left',
}: DropdownProps): React.ReactElement => {
  const [open, setOpen] = React.useState(false);
  const { triggerRef, layerRef, position } = useAnchoredLayer<HTMLSpanElement, HTMLDivElement>({
    open,
    align: align === 'right' ? 'end' : 'start',
    minWidth: MIN_WIDTH,
  });

  useDismiss({ open, onDismiss: () => setOpen(false), refs: [triggerRef, layerRef] });

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
    <>
      <Wrapper ref={triggerRef}>{trigger}</Wrapper>
      {open && position ? (
        <Portal>
          <Menu
            ref={layerRef}
            role="menu"
            $top={position.top}
            $left={position.left}
            $maxHeight={position.maxHeight}
          >
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
        </Portal>
      ) : null}
    </>
  );
};
