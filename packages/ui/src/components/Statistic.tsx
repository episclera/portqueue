import React from 'react';
import styled, { css } from 'styled-components';

export type StatisticTone = 'default' | 'brand' | 'success' | 'danger' | 'warning';

export interface StatisticProps {
  label: React.ReactNode;
  value: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  tone?: StatisticTone;
  /** Place the label below the value instead of above. */
  labelBelow?: boolean;
}

const toneColor = (tone: StatisticTone): ReturnType<typeof css> => {
  switch (tone) {
    case 'brand':
      return css`
        color: ${(p) => p.theme.color.brand};
      `;
    case 'success':
      return css`
        color: ${(p) => p.theme.color.success};
      `;
    case 'danger':
      return css`
        color: ${(p) => p.theme.color.danger};
      `;
    case 'warning':
      return css`
        color: ${(p) => p.theme.color.warning};
      `;
    default:
      return css`
        color: ${(p) => p.theme.color.text};
      `;
  }
};

const Root = styled.div<{ $below: boolean }>`
  display: flex;
  flex-direction: ${(p) => (p.$below ? 'column-reverse' : 'column')};
  gap: ${(p) => p.theme.space(1)};
`;

const Label = styled.div`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: ${(p) => p.theme.color.textMuted};
`;

const Value = styled.div<{ $tone: StatisticTone }>`
  display: inline-flex;
  align-items: baseline;
  gap: ${(p) => p.theme.space(1)};
  font-family: ${(p) => p.theme.font.display};
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  ${(p) => toneColor(p.$tone)}
`;

const Affix = styled.span`
  font-size: 16px;
  font-weight: 600;
  color: ${(p) => p.theme.color.textMuted};
`;

/** A big headline value with an uppercase label and optional prefix/suffix and tone colour. */
export function Statistic({
  label,
  value,
  prefix,
  suffix,
  tone = 'default',
  labelBelow = false,
}: StatisticProps): React.ReactElement {
  return (
    <Root $below={labelBelow}>
      <Label>{label}</Label>
      <Value $tone={tone}>
        {prefix !== undefined ? <Affix>{prefix}</Affix> : null}
        <span>{value}</span>
        {suffix !== undefined ? <Affix>{suffix}</Affix> : null}
      </Value>
    </Root>
  );
}
