// Generates `src/theme.css` from `src/tokens.json`, the single source of truth for the palette.
//
//   node scripts/build-css.mjs          write the stylesheet
//   node scripts/build-css.mjs --check  fail if the committed stylesheet is out of date (lint/CI)
//
// The stylesheet is committed rather than built on demand so a consumer — the dashboard's Vite
// build, Docusaurus's webpack, a Jest run — can import it with no prior build step. `--check` is
// what keeps the committed copy honest: edit the JSON, run the script, commit both.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = join(root, 'src/tokens.json');
const cssPath = join(root, 'src/theme.css');

const tokens = JSON.parse(await readFile(tokensPath, 'utf8'));

/** `brandHover` → `brand-hover`, `2` → `2`. */
const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const block = (selector, lines) => `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}\n`;
const vars = (prefix, record, unit = '') =>
  Object.entries(record).map(([key, value]) => `--pq-${prefix}-${kebab(key)}: ${value}${unit};`);

const light = [
  ...vars('color', tokens.palette),
  ...vars('color', tokens.modes.light),
  ...Object.entries(tokens.status).map(
    ([key, value]) => `--pq-color-status-${key.toLowerCase()}: ${value};`,
  ),
  ...vars('radius', tokens.radius, 'px'),
  ...vars('space', tokens.space, 'px'),
  ...vars('font-size', tokens.fontSize, 'px'),
  `--pq-font-body: ${tokens.font.body};`,
  `--pq-font-display: ${tokens.font.display};`,
  `--pq-font-mono: ${tokens.font.mono};`,
  `--pq-line-height: ${tokens.lineHeight};`,
  ...vars('shadow', tokens.shadow),
  `--pq-motion-easing: ${tokens.motion.easing};`,
  `--pq-motion-fast: ${tokens.motion.fastMs}ms;`,
  `--pq-motion-base: ${tokens.motion.baseMs}ms;`,
  `--pq-motion-slow: ${tokens.motion.slowMs}ms;`,
  'color-scheme: light;',
];

const dark = [...vars('color', tokens.modes.dark), 'color-scheme: dark;'];

const raw =
  `/*\n` +
  ` * GENERATED from tokens.json by scripts/build-css.mjs — do not edit by hand.\n` +
  ` *\n` +
  ` * The PortQueue theme as CSS custom properties, shared by the dashboard and the docs site.\n` +
  ` * Light is the default; dark applies under \`data-theme="dark"\` on any ancestor (in practice\n` +
  ` * <html>), which is the attribute Docusaurus already sets and the dashboard sets to match.\n` +
  ` * Breakpoints are not here: \`@media\` cannot read \`var()\`, so they live in tokens.json only.\n` +
  ` */\n\n` +
  block(":root,\n[data-theme='light']", light) +
  '\n' +
  block("[data-theme='dark']", dark);

// Formatted with the repo's own Prettier config, so `format:check` agrees with the generator.
const css = await prettier.format(raw, {
  ...(await prettier.resolveConfig(cssPath)),
  filepath: cssPath,
});

if (process.argv.includes('--check')) {
  const current = await readFile(cssPath, 'utf8').catch(() => '');
  if (current !== css) {
    console.error(
      'src/theme.css is out of date with src/tokens.json — run `npm run build -w @portqueue/theme`.',
    );
    process.exit(1);
  }
} else {
  await writeFile(cssPath, css);
}
