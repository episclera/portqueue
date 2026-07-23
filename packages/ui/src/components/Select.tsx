import React from 'react';
import styled, { css } from 'styled-components';

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
  position: relative;
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
  transition: border-color ${(p) => p.theme.motion.fast}, box-shadow ${(p) => p.theme.motion.fast};

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

const Caret = styled.span<{ $open: boolean }>`
  flex: none;
  font-size: 0.75em;
  color: ${(p) => p.theme.color.textMuted};
  transition: transform ${(p) => p.theme.motion.fast};
  transform: rotate(${(p) => (p.$open ? '180deg' : '0deg')});
`;

const Label = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Menu = styled.ul`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: ${(p) => p.theme.zIndex.drawer};
  margin: 0;
  padding: ${(p) => p.theme.space(1)};
  list-style: none;
  max-height: 260px;
  overflow-y: auto;
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
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = (next: T): void => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Wrapper ref={wrapperRef} $block={block}>
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
        <Caret $open={open} aria-hidden>
          ▾
        </Caret>
      </Trigger>
      {open && (
        <Menu role="listbox">
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
                {isSelected ? <span aria-hidden>✓</span> : null}
              </Item>
            );
          })}
        </Menu>
      )}
    </Wrapper>
  );
}
