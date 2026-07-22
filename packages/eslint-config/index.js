import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint base for every PortQueue workspace (build_plan/01.5).
 * Each workspace re-exports this and layers local overrides.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Relax `no-explicit-any` in tests (build_plan/01.5).
    files: ['**/*.test.ts', '**/__tests__/**', '**/test-utils/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'build/**', 'coverage/**', 'node_modules/**'],
  },
);
