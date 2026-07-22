/** A dependency-free inline SVG sparkline for throughput trends. */
import React from 'react';
import { tokens } from '@portqueue/ui';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({
  values,
  width = 96,
  height = 28,
  color,
}: SparklineProps): React.ReactElement {
  const stroke = color ?? tokens.color.accent;
  if (values.length < 2) {
    return (
      <svg width={width} height={height} role="img" aria-label="sparkline">
        <line
          x1={0}
          y1={height - 2}
          x2={width}
          y2={height - 2}
          stroke={stroke}
          strokeOpacity={0.3}
          strokeWidth={2}
        />
      </svg>
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="sparkline"
      style={{ overflow: 'visible' }}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
