import base from '@portqueue/eslint-config';

/** Icons come from the curated set in `src/icons.ts` (see the Brandbook), so that file is the
 *  only one allowed to reach for the icon package. */
const iconsOnlyFromCuratedSet = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/icons.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@ant-design/icons', '@ant-design/icons/*'],
            message: "Import icons from '../icons' — the curated set — not @ant-design/icons.",
          },
        ],
      },
    ],
  },
};

export default [...base, { ignores: ['dist/**'] }, iconsOnlyFromCuratedSet];
