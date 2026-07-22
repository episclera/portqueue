/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // Resolve the workspace sibling to its source so tests need no prior build.
    '^@portqueue/core$': '<rootDir>/../core/src/index.ts',
    // NodeNext ESM requires .js extensions on relative imports; strip them for ts-jest.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        // Transpile-only: cross-package type-checking (the mapped @portqueue/core
        // source) is handled by `tsc --noEmit` in the lint step, not here.
        isolatedModules: true,
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
    '!src/test-support/**',
    '!src/cli.ts',
    '!src/index.ts',
    '!src/commands/types.ts',
    // The dashboard command boots a real HTTP server; listen streams forever — both
    // are integration-shaped and out of scope for unit coverage.
    '!src/commands/dashboard.ts',
    '!src/commands/listen.ts',
  ],
  coverageProvider: 'v8',
  testTimeout: 15000,
};
