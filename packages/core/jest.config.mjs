/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // NodeNext ESM requires .js extensions on relative imports; strip them for ts-jest.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          verbatimModuleSyntax: false,
          module: 'ESNext',
          moduleResolution: 'bundler',
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/test-utils/**',
    '!src/**/index.ts',
    // Postgres/Oracle drivers require a live server; validated by the conformance kit
    // against real servers, not in CI (build_plan/16.1). PGLite/SQLite cover the dialects.
    '!src/drivers/postgres/**',
    '!src/drivers/oracle/**',
    // Type-only modules (interfaces/option shapes) have no runtime behavior to cover.
    '!src/**/*.interface.ts',
    '!src/options/job-options.ts',
    '!src/options/queue-options.ts',
    '!src/options/worker-options.ts',
    '!src/options/client-options.ts',
    '!src/options/common.ts',
    '!src/jobs/job.ts',
    '!src/jobs/job-record.ts',
    '!src/producer/results.ts',
    '!src/client/runtime.ts',
  ],
  coverageProvider: 'v8',
  coverageThreshold: {
    global: { statements: 85, branches: 75, functions: 75, lines: 85 },
  },
  testTimeout: 15000,
};
