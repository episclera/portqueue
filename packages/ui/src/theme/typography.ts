/** Font stacks. Self-hosted / system — no third-party CDN calls. */
export const typography = {
  /** Modern variable/system UI stack. */
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Inter", system-ui, sans-serif',
  /** Distinctive display stack for the wordmark. */
  displayFontFamily: '"Space Grotesk", "Segoe UI", system-ui, sans-serif',
  monoFamily:
    '"JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
  lineHeight: 1.6,
} as const;
