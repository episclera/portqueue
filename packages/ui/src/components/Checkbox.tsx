import styled from 'styled-components';

/** Themed checkbox — used by Table's selection column and any filter/option list. */
export const Checkbox = styled.input.attrs({ type: 'checkbox' })`
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: ${(p) => p.theme.color.brandHover};
  cursor: pointer;
`;
