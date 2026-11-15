/**
 * Client SPA build. Bundles the React app → ./dist/client, which the middleware serves via
 * server/assets.ts. Everything ships under a single `dist/` (the server at dist/index.{mjs,cjs},
 * the SPA under dist/client). Resolves the workspace `@portqueue/core` and `@portqueue/theme` to
 * their source so the SPA renders with the exact tokens the docs site uses (`@portqueue/theme` is
 * private and gets bundled here, never published). Components are antd, bundled too.
 *
 * **One chunk, on purpose.** Route-level splitting is possible — the assets route serves whatever
 * Vite emits — but it buys little and costs something real here. The whole SPA is ~1.25MB / 400kB
 * gzipped (most of it antd and its CSS-in-JS runtime, which every route needs anyway), served from the same origin as the API by a middleware that now marks content-hashed
 * assets `immutable`, so it is fetched once per deploy by an audience of operators who keep the
 * tab open. Splitting would trade that single request for a waterfall on every first navigation
 * to each route, and add lazy-boundary states to maintain. Revisit if the gzipped bundle grows
 * well past its current size or the dashboard picks up a page a casual visitor lands on directly;
 * the warning limit below sits just above today's size so growth still gets flagged.
 *
 * Source maps are off for the same reason they usually are: the bundle ships inside a package
 * installed into someone else's app, and a map would roughly triple what npm has to carry.
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
      '@portqueue/theme/theme.css': resolve(__dirname, '../theme/src/theme.css'),
      '@portqueue/theme': resolve(__dirname, '../theme/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist/client',
    // Do NOT empty dist — the server build (run first) already populated dist/.
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      onwarn(warning, warn) {
        // React Query ships `"use client"` directives for RSC. This is a plain browser bundle
        // with no server components, so the directive is correctly ignored — but Rollup warns
        // about it once per module, burying anything worth reading.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
});
