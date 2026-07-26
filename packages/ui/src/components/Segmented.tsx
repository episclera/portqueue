import styled from 'styled-components';

export interface SegmentedOption<T extends string> {
  label: React.ReactNode;
  value: T;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
}

const Track = styled.div<{ $size: 'sm' | 'md' }>`
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: ${(p) => p.theme.color.surfaceAlt};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  font-size: ${(p) => (p.$size === 'sm' ? 12 : 13)}px;
`;

const Segment = styled.button<{ $active: boolean }>`
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: ${(p) => p.theme.radii.sm}px;
  color: ${(p) => (p.$active ? p.theme.color.link : p.theme.color.textMuted)};
  background: ${(p) => (p.$active ? p.theme.color.surface : 'transparent')};
  box-shadow: ${(p) => (p.$active ? p.theme.shadow.sm : 'none')};
  transition:
    color ${(p) => p.theme.motion.fast},
    background ${(p) => p.theme.motion.fast};
  &:hover {
    color: ${(p) => (p.$active ? p.theme.color.link : p.theme.color.text)};
  }
`;

/** Segmented single-select control (theme switcher, small filters). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: SegmentedProps<T>): React.ReactElement {
  return (
    <Track $size={size} role="tablist">
      {options.map((o) => (
        <Segment
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          $active={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Segment>
      ))}
    </Track>
  );
}
