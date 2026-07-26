import React from 'react';
import styled from 'styled-components';

export const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space(4)};
`;

export interface FieldProps {
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}

const FieldRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space(2)};
`;

const FieldLabel = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: ${(p) => p.theme.color.text};
`;

const RequiredMark = styled.span`
  margin-left: 2px;
  color: ${(p) => p.theme.color.danger};
`;

const FieldError = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${(p) => p.theme.color.danger};
`;

const FieldHint = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${(p) => p.theme.color.textMuted};
`;

/** Presentational field wrapper — label, control, then an error or hint below. */
export function Field({
  label,
  required = false,
  error,
  hint,
  htmlFor,
  children,
}: FieldProps): React.ReactElement {
  return (
    <FieldRoot>
      {label !== undefined && (
        <FieldLabel htmlFor={htmlFor}>
          {label}
          {required ? <RequiredMark aria-hidden>*</RequiredMark> : null}
        </FieldLabel>
      )}
      {children}
      {error !== undefined && error !== null && error !== false ? (
        <FieldError role="alert">{error}</FieldError>
      ) : hint !== undefined && hint !== null && hint !== false ? (
        <FieldHint>{hint}</FieldHint>
      ) : null}
    </FieldRoot>
  );
}
