/**
 * Ambient augmentation so `props.theme` is typed as our `Theme` everywhere styled-components
 * is used — INCLUDING consumers (dashboard, docs) that import from this package. It must be an
 * imported module (not a stray `.d.ts`) so it lands in each consumer's TS program; `index.ts`
 * imports it for its declarations.
 */
import type { Theme } from './theme.js';

declare module 'styled-components' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefaultTheme extends Theme {}
}
