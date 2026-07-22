import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
      external: [/^node:/, '@portqueue/core', '@portqueue/dashboard'],
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
