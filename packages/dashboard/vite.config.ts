/**
 * Server library build (build_plan/12.2). Emits ESM + CJS + .d.ts for the middleware surface
 * only. Externalizes react/react-dom (client-only), @portqueue/core (peer), and node builtins.
 * The client SPA is built separately by vite.client.config.ts into ./client-dist.
 */
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
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@portqueue/core',
        '@portqueue/ui',
        'react-router-dom',
      ],
    },
    target: 'node20',
    sourcemap: true,
    minify: false,
    // Do not wipe client-dist (built by the other config).
    emptyOutDir: true,
  },
  plugins: [
    dts({
      // Only the server + shared surface ships types; the client SPA is a runtime artifact.
      entryRoot: 'src',
      include: ['src/index.ts', 'src/server/**', 'src/shared/**'],
      exclude: ['src/client/**', 'src/**/*.test.ts'],
    }),
  ],
});
