import base from '@portqueue/eslint-config';

/** The dashboard takes every icon from `@portqueue/ui`'s curated set, never straight from the
 *  icon package — see the Brandbook's iconography rules. */
const iconsOnlyFromUi = {
  files: ['src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@ant-design/icons', '@ant-design/icons/*'],
            message: "Import icons from '@portqueue/ui', not @ant-design/icons.",
          },
        ],
      },
    ],
  },
};

export default [...base, { ignores: ['dist/**'] }, iconsOnlyFromUi];
