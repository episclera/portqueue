import styled from 'styled-components';
import { Button } from './Button';

/**
 * Square, label-less button for an icon — same sizes and variants as `Button`, so the label
 * lives in `aria-label` (and usually a Tooltip) instead of beside the glyph.
 */
export const IconButton = styled(Button)`
  width: ${(p) => (p.size === 'lg' ? 46 : p.size === 'md' ? 38 : 30)}px;
  padding: 0;
  font-size: 14px;
`;
