import React from 'react';
import styled, { keyframes } from 'styled-components';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  circle?: boolean;
  radius?: number;
}

export interface SkeletonTextProps {
  rows?: number;
  width?: number | string;
}

const shimmer = keyframes`
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
`;

const toDim = (v: number | string | undefined, fallback: string): string =>
  v === undefined ? fallback : typeof v === 'number' ? `${v}px` : v;

const Block = styled.span<{
  $width: string;
  $height: string;
  $circle: boolean;
  $radius: number;
}>`
  display: block;
  width: ${(p) => p.$width};
  height: ${(p) => p.$height};
  border-radius: ${(p) => (p.$circle ? '999px' : `${p.$radius}px`)};
  background: linear-gradient(
    90deg,
    ${(p) => p.theme.color.surfaceAlt} 25%,
    ${(p) => p.theme.color.border} 37%,
    ${(p) => p.theme.color.surfaceAlt} 63%
  );
  background-size: 200% 100%;
  animation: ${shimmer} 1.4s ease infinite;
`;

const TextRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space(2)};
`;

/** A single shimmering placeholder block; `circle` makes it round. */
export function Skeleton({
  width,
  height,
  circle = false,
  radius = 6,
}: SkeletonProps): React.ReactElement {
  return (
    <Block
      $width={toDim(width, circle ? '40px' : '100%')}
      $height={toDim(height, circle ? '40px' : '16px')}
      $circle={circle}
      $radius={radius}
      aria-hidden
    />
  );
}

/** Several shimmering text lines; the last line is rendered shorter. */
export function SkeletonText({ rows = 3, width }: SkeletonTextProps): React.ReactElement {
  const count = Math.max(rows, 1);
  return (
    <TextRoot aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          height={12}
          width={i === count - 1 ? '60%' : toDim(width, '100%')}
        />
      ))}
    </TextRoot>
  );
}
