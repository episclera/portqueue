/**
 * Server library build (build_plan/12.2). Emits ESM + CJS + .d.ts for the middleware surface
 * only. Externalizes react/react-dom (client-only), @portqueue/core (peer), and node builtins.
 * The client SPA is built separately by vite.client.config.ts into ./client-dist.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: [
        /^node:/,
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@portqueue/core',
        '@portqueue/ui',
        'antd',
        'antd-style',
        'react-router-dom',
        '@ant-design/icons',
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
