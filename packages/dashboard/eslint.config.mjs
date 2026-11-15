import base from '@portqueue/eslint-config';

/** The dashboard takes every icon from its curated set in `src/client/icons.ts`, never straight
 *  from the icon package — see the Brandbook's iconography rules. Tags all go through ToneTag. */
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
        paths: [
          {
            name: 'antd',
            importNames: ['Tag'],
            message:
              'Use ToneTag (or StatusTag / the state tags) from components/StateTags.tsx: every tag has a border in its text colour over a light tint of it.',
          },
        ],
      },
    ],
  },
};

/** StateTags.tsx builds the one tag look, so it is the only file that may touch antd's Tag. */
const tagBuilder = {
  files: ['src/client/components/StateTags.tsx'],
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [{ group: ['@ant-design/icons', '@ant-design/icons/*'] }] },
    ],
  },
};

export default [...base, { ignores: ['dist/**'] }, iconsOnlyFromCuratedSet, tagBuilder];
