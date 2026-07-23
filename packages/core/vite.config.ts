import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Library build (build_plan/01.3). Emits ESM + CJS + .d.ts. Each driver is its own
// entry so importing one driver never pulls in another engine's peer client.
const entries = {
  index: resolve(__dirname, 'src/index.ts'),
  'drivers/postgres/index': resolve(__dirname, 'src/drivers/postgres/index.ts'),
  'drivers/pglite/index': resolve(__dirname, 'src/drivers/pglite/index.ts'),
  'drivers/sqlite/index': resolve(__dirname, 'src/drivers/sqlite/index.ts'),
  'drivers/oracle/index': resolve(__dirname, 'src/drivers/oracle/index.ts'),
  'drivers/mysql/index': resolve(__dirname, 'src/drivers/mysql/index.ts'),
  'tx/index': resolve(__dirname, 'src/tx/index.ts'),
  'conformance/index': resolve(__dirname, 'src/conformance/index.ts'),
};

export default defineConfig({
  build: {
    lib: {
      entry: entries,
      formats: ['es', 'cjs'],
      // Reliable entry naming for multi-entry libs: index.mjs / index.cjs, etc.
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      // Externalize node built-ins and every optional peer DB client.
      external: [
        /^node:/,
        'pg',
        '@electric-sql/pglite',
        'better-sqlite3',
        'oracledb',
        'mysql2',
        'mysql2/promise',
      ],
    },
    target: 'node20',
    sourcemap: true,
    minify: false,
  },
  plugins: [dts({ include: ['src'], exclude: ['src/**/*.test.ts', 'src/test-utils/**'] })],
});
