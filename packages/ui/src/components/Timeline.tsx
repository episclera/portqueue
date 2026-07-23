import React from 'react';
import styled from 'styled-components';

export interface TimelineItem {
  key: string;
  color?: string;
  dot?: React.ReactNode;
  label?: React.ReactNode;
  children: React.ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
}

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Item = styled.li<{ $last: boolean }>`
  position: relative;
  padding: 0 0 ${(p) => (p.$last ? '0' : p.theme.space(4))} ${(p) => p.theme.space(6)};
  &::before {
    content: '';
    position: absolute;
    left: 7px;
    top: 18px;
    bottom: 0;
    width: 2px;
    background: ${(p) => p.theme.color.border};
    display: ${(p) => (p.$last ? 'none' : 'block')};
  }
`;

const Dot = styled.span<{ $color?: string }>`
  position: absolute;
  left: 0;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: ${(p) => p.$color ?? p.theme.color.brand};
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  box-shadow: 0 0 0 3px ${(p) => p.theme.color.bg};
`;

const Label = styled.div`
  font-size: 12px;
  color: ${(p) => p.theme.color.textMuted};
  margin-bottom: ${(p) => p.theme.space(1)};
`;

const Body = styled.div`
  font-size: 14px;
  color: ${(p) => p.theme.color.text};
  line-height: 1.5;
`;

/** Vertical timeline — coloured dots connected by a line, with optional labels and body content. */
export function Timeline({ items }: TimelineProps): React.ReactElement {
  return (
    <List>
      {items.map((item, index) => (
        <Item key={item.key} $last={index === items.length - 1}>
          <Dot $color={item.color} aria-hidden>
            {item.dot}
          </Dot>
          {item.label !== undefined ? <Label>{item.label}</Label> : null}
          <Body>{item.children}</Body>
        </Item>
      ))}
    </List>
  );
}
