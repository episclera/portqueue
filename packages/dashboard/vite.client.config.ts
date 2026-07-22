/**
 * Client SPA build (build_plan/12.2). Bundles the React app → ./dist/client, which the
 * middleware serves via server/assets.ts. Everything ships under a single `dist/` (the
 * server at dist/index.{mjs,cjs}, the SPA under dist/client). Resolves the workspace
 * `@portqueue/core` and `@portqueue/ui` to their source so the SPA shares the exact theme +
 * StatusTag + Logo (`@portqueue/ui` is private and gets bundled here, never published).
 *
 * NOTE: `@vitejs/plugin-react` is not a dependency here; JSX is transpiled by Vite's built-in
 * esbuild using the automatic runtime configured below (no React Fast Refresh, which the
 * production bundle does not need).
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  base: './',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@portqueue/core': resolve(__dirname, '../core/src/index.ts'),
      '@portqueue/ui': resolve(__dirname, '../ui/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist/client',
    // Do NOT empty dist — the server build (run first) already populated dist/.
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
