// Jest-only interop shim for styled-components.
//
// styled-components ships CJS whose real styled() function lives on `module.exports.default`.
// Under ts-jest's ESM mode a bare `import styled from 'styled-components'` binds the whole
// module.exports object (so `styled.div` is undefined). The app doesn't hit this because Vite
// applies default-interop; Jest does not. This shim re-exports the unwrapped default plus the
// named members the UI uses. Mapped in jest.config.mjs via moduleNameMapper.
//
// The import below targets the CJS build by explicit path so the `^styled-components$` module
// mapping can't match it (which would recurse into this shim forever).
import sc from 'styled-components/dist/styled-components.cjs.js';

const styled = sc.default ?? sc;

export default styled;
export const css = sc.css;
export const keyframes = sc.keyframes;
export const createGlobalStyle = sc.createGlobalStyle;
export const ThemeProvider = sc.ThemeProvider;
export const useTheme = sc.useTheme;
export const StyleSheetManager = sc.StyleSheetManager;
