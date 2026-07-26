/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  // Default to Node; component tests opt into jsdom via a per-file docblock:
  //   /** @jest-environment jsdom */
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: {
    // Resolve workspace siblings to their source so tests need no prior build.
    '^@portqueue/core$': '<rootDir>/../core/src/index.ts',
    '^@portqueue/ui$': '<rootDir>/../ui/src/index.ts',
    // styled-components is CJS with the styled() fn on `.default`; ts-jest's ESM mode doesn't
    // apply default-interop, so route it through a shim that unwraps it (see the shim's header).
    '^styled-components$': '<rootDir>/src/test-support/styled-components-shim.mjs',
    // Stub stylesheet imports (jsdom can't parse CSS and we don't assert on it).
    '\\.(css|less|scss)$': '<rootDir>/src/test-support/style-stub.js',
    // NodeNext ESM requires .js extensions on relative imports; strip them for ts-jest.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // Transpile-only: type-checking is handled by `tsc --noEmit` in the lint step.
        isolatedModules: true,
        tsconfig: {
          verbatimModuleSyntax: false,
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
        },
      },
    ],
  },
  // The client counts too. Limiting this to `src/server/**` excluded every hook, page and
  // component by construction, so the coverage report couldn't show that the client was untested.
  collectCoverageFrom: [
    'src/server/**/*.ts',
    'src/shared/**/*.ts',
    'src/client/**/*.{ts,tsx}',
    '!src/client/main.tsx', // the mount point; nothing to assert that a render test doesn't
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
  ],
  coverageProvider: 'v8',
  testTimeout: 15000,
};
