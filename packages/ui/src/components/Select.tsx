import React from 'react';
import styled, { css } from 'styled-components';
import { Portal } from '../overlay/Portal';
import { useAnchoredLayer } from '../overlay/useAnchoredLayer';
import { useDismiss } from '../overlay/useDismiss';
import { CaretDownIcon, CheckIcon } from '../icons';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption<T extends string | number> {
  label: React.ReactNode;
  value: T;
}

export interface SelectProps<T extends string | number> {
  value: T | undefined;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: React.ReactNode;
  disabled?: boolean;
  block?: boolean;
  size?: SelectSize;
}

const SIZES: Record<SelectSize, { h: number; px: number; fs: number }> = {
  sm: { h: 30, px: 10, fs: 13 },
  md: { h: 38, px: 12, fs: 14 },
  lg: { h: 46, px: 14, fs: 16 },
};

const Wrapper = styled.div<{ $block: boolean }>`
  display: ${(p) => (p.$block ? 'block' : 'inline-block')};
  width: ${(p) => (p.$block ? '100%' : 'auto')};
`;

const Trigger = styled.button<{ $size: SelectSize; $open: boolean; $placeholder: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space(2)};
  width: 100%;
  height: ${(p) => SIZES[p.$size].h}px;
  padding: 0 ${(p) => SIZES[p.$size].px}px;
  font-size: ${(p) => SIZES[p.$size].fs}px;
  font-family: inherit;
  text-align: left;
  color: ${(p) => (p.$placeholder ? p.theme.color.textFaint : p.theme.color.text)};
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => (p.$open ? p.theme.color.brand : p.theme.color.border)};
  border-radius: ${(p) => p.theme.radii.md}px;
  cursor: pointer;
  box-sizing: border-box;
  transition:
    border-color ${(p) => p.theme.motion.fast},
    box-shadow ${(p) => p.theme.motion.fast};

  ${(p) =>
    p.$open &&
    css`
      box-shadow: 0 0 0 3px ${p.theme.color.brand}33;
    `}

  &:hover:not(:disabled) {
    border-color: ${(p) => (p.$open ? p.theme.color.brand : p.theme.color.borderStrong)};
  }

  &:focus-visible {
    outline: none;
    border-color: ${(p) => p.theme.color.brand};
    box-shadow: 0 0 0 3px ${(p) => p.theme.color.brand}33;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const Caret = styled(CaretDownIcon)<{ $open: boolean }>`
  flex: none;
  font-size: 11px;
  color: ${(p) => p.theme.color.textMuted};
  transition: transform ${(p) => p.theme.motion.fast};
  transform: rotate(${(p) => (p.$open ? '180deg' : '0deg')});
`;

const Label = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/** Preferred menu height; shrinks further when the viewport leaves less room. */
const MAX_MENU_HEIGHT = 260;

/**
 * Rendered in a body portal at fixed viewport coordinates and stretched to the trigger width,
 * so a select inside a Card, a modal or a scrolling table is never clipped or under-stacked.
 */
const Menu = styled.ul<{ $top: number; $left: number; $width: number; $maxHeight: number }>`
  position: fixed;
  top: ${(p) => p.$top}px;
  left: ${(p) => p.$left}px;
  width: ${(p) => p.$width}px;
  z-index: ${(p) => p.theme.zIndex.select};
  margin: 0;
  padding: ${(p) => p.theme.space(1)};
  list-style: none;
  max-height: ${(p) => p.$maxHeight}px;
  overflow-y: auto;
  box-sizing: border-box;
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  box-shadow: ${(p) => p.theme.shadow.md};
`;

const Item = styled.li<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space(2)};
  padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
  font-size: 14px;
  border-radius: ${(p) => p.theme.radii.sm}px;
  cursor: pointer;
  color: ${(p) => (p.$selected ? p.theme.color.brand : p.theme.color.text)};
  background: ${(p) => (p.$selected ? `${p.theme.color.brand}14` : 'transparent')};
  font-weight: ${(p) => (p.$selected ? 600 : 400)};

  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
  }
`;

/** Bespoke custom-control select — no native `<select>`; keyboard + outside-click aware. */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  block = false,
  size = 'md',
}: SelectProps<T>): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const { triggerRef, layerRef, position } = useAnchoredLayer<HTMLDivElement, HTMLUListElement>({
    open,
    align: 'stretch',
    gap: 4,
  });

  const selected = options.find((option) => option.value === value);

  useDismiss({ open, onDismiss: () => setOpen(false), refs: [triggerRef, layerRef] });

  const handleSelect = (next: T): void => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Wrapper ref={triggerRef} $block={block}>
      <Trigger
        type="button"
        $size={size}
        $open={open}
        $placeholder={selected === undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Label>{selected ? selected.label : placeholder}</Label>
        <Caret $open={open} aria-hidden />
      </Trigger>
      {open && position ? (
        <Portal>
          <Menu
            ref={layerRef}
            role="listbox"
            $top={position.top}
            $left={position.left}
            $width={position.width ?? 0}
            $maxHeight={Math.min(MAX_MENU_HEIGHT, position.maxHeight)}
          >
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <Item
                  key={String(option.value)}
                  role="option"
                  aria-selected={isSelected}
                  $selected={isSelected}
                  onClick={() => handleSelect(option.value)}
                >
                  <span>{option.label}</span>
                  {isSelected ? <CheckIcon aria-hidden /> : null}
                </Item>
              );
            })}
          </Menu>
        </Portal>
      ) : null}
    </Wrapper>
  );
}
