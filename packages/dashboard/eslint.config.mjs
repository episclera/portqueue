import base from '@portqueue/eslint-config';

/** The dashboard takes every icon from its curated set in `src/client/icons.ts`, never straight
 *  from the icon package — see the Brandbook's iconography rules. */
const iconsOnlyFromCuratedSet = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/client/icons.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@ant-design/icons', '@ant-design/icons/*'],
            message: "Import icons from 'src/client/icons.ts', not @ant-design/icons.",
          },
        ],
      },
    ],
  },
};

export default [...base, { ignores: ['dist/**'] }, iconsOnlyFromCuratedSet];
