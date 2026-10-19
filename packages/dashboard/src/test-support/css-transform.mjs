// Jest transform for stylesheets. Rather than stubbing CSS out, it injects each file into jsdom's
// document as a <style>, so a test that reads `getComputedStyle` sees the real rules.
//
// A `*.module.css` gets its class names scoped to the file (`Shot.module.css` → `.row` becomes
// `.Shot__row`) — the same isolation Vite's CSS Modules give, so two modules that both define
// `.row` cannot leak into each other here either — and exports the local → scoped map. A plain
// `.css` (the theme variables, the global styles) is injected as written and exports nothing.
//
// The class-selector match requires a letter or `_` after the dot, so decimals (`0.5rem`) are not
// mistaken for classes. Mapped from jest.config.mjs's `transform`.
import path from 'node:path';

export default {
  process(source, filename) {
    let css = source;
    const classes = {};
    if (filename.endsWith('.module.css')) {
      const prefix = path.basename(filename, '.module.css');
      css = source.replace(/(^|[^\w-])\.([A-Za-z_][\w-]*)/g, (_, before, name) => {
        classes[name] = `${prefix}__${name}`;
        return `${before}.${prefix}__${name}`;
      });
    }
    return {
      code:
        `if (typeof document !== 'undefined') {\n` +
        `  const style = document.createElement('style');\n` +
        `  style.textContent = ${JSON.stringify(css)};\n` +
        `  document.head.appendChild(style);\n` +
        `}\n` +
        `module.exports = ${JSON.stringify(classes)};\n`,
    };
  },
};
