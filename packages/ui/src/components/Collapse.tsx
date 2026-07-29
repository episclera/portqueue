import React from 'react';
import styled from 'styled-components';
import { CaretRightIcon } from '../icons';

export interface CollapseItem {
  key: string;
  header: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}

export interface CollapseProps {
  items: CollapseItem[];
  defaultActiveKeys?: string[];
  multiple?: boolean;
}

const Root = styled.div`
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  overflow: hidden;
  background: ${(p) => p.theme.color.surface};
`;

const Panel = styled.div`
  & + & {
    border-top: 1px solid ${(p) => p.theme.color.border};
  }
`;

const Header = styled.button`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  width: 100%;
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)};
  background: transparent;
  border: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: ${(p) => p.theme.color.text};
  text-align: left;
  cursor: pointer;
  transition: background ${(p) => p.theme.motion.fast};
  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.brand};
    outline-offset: -2px;
  }
`;

const Indicator = styled(CaretRightIcon)<{ $open: boolean }>`
  display: inline-flex;
  font-size: 12px;
  color: ${(p) => p.theme.color.textMuted};
  transform: rotate(${(p) => (p.$open ? '90deg' : '0deg')});
  transition: transform ${(p) => p.theme.motion.fast};
`;

const HeaderLabel = styled.span`
  flex: 1;
`;

const Extra = styled.span`
  color: ${(p) => p.theme.color.textMuted};
  font-weight: 500;
`;

const Body = styled.div`
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)} ${(p) => p.theme.space(4)};
  font-size: 14px;
  color: ${(p) => p.theme.color.text};
  line-height: 1.5;
  border-top: 1px solid ${(p) => p.theme.color.border};
`;

/** Accordion — clickable headers toggle panels; `multiple` allows several open at once. */
export function Collapse({
  items,
  defaultActiveKeys = [],
  multiple = false,
}: CollapseProps): React.ReactElement {
  const [activeKeys, setActiveKeys] = React.useState<string[]>(defaultActiveKeys);

  const toggle = (key: string): void => {
    setActiveKeys((prev) => {
      const isOpen = prev.includes(key);
      if (multiple) {
        return isOpen ? prev.filter((k) => k !== key) : [...prev, key];
      }
      return isOpen ? [] : [key];
    });
  };

  return (
    <Root>
      {items.map((item) => {
        const open = activeKeys.includes(item.key);
        return (
          <Panel key={item.key}>
            <Header type="button" aria-expanded={open} onClick={() => toggle(item.key)}>
              <Indicator $open={open} aria-hidden />
              <HeaderLabel>{item.header}</HeaderLabel>
              {item.extra !== undefined ? <Extra>{item.extra}</Extra> : null}
            </Header>
            {open ? <Body>{item.children}</Body> : null}
          </Panel>
        );
      })}
    </Root>
  );
}
