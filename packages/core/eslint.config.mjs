import base from '@portqueue/eslint-config';

export default [
  ...base,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
];
