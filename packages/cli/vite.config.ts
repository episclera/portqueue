import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Bundled CJS deps require built-ins by their bare name (`require('buffer')`, not
// `require('node:buffer')`). Those must be externalized too, or Vite resolves them to its
// empty browser stub and the module blows up at import time.
const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // Externalize node built-ins, the core package (including its ./drivers/* subpaths,
      // which pull in optional DB peer deps that must not be bundled), and the dashboard.
      external: [...nodeBuiltins, /^@portqueue\/core(\/.*)?$/, '@portqueue/dashboard'],
      output: {
        entryFileNames: '[name].mjs',
        banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node' : ''),
      },
    },
    target: 'node20',
    sourcemap: true,
    minify: false,
  },
  plugins: [dts({ include: ['src'] })],
});
