import React from 'react';
import styled from 'styled-components';
import { fieldBaseStyles } from './Input.js';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const StyledTextarea = styled.textarea<{ $invalid: boolean }>`
  ${fieldBaseStyles}
  min-height: 88px;
  padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
`;

/** Bespoke multiline input — matches Input's visual language with vertical resize. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, ...rest },
  ref,
): React.ReactElement {
  return <StyledTextarea ref={ref} $invalid={invalid} aria-invalid={invalid || undefined} {...rest} />;
});
