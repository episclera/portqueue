/**
 * semantic-release: every push to main that carries a releasable commit publishes, with no release
 * PR in between. `@portqueue/core`, `@portqueue/dashboard` and `@portqueue/cli` are one product
 * installed together, so they share one version, one `v<version>` tag, one GitHub release and one
 * root CHANGELOG.md.
 *
 * The bump comes from the Conventional Commits since the last tag: `!` / `BREAKING CHANGE` → major,
 * `feat` → minor, every other type (`fix`, `refactor`, `docs`, `ci`, `chore`, …) → patch.
 */

/** The published workspaces — private ones (`ui`, `eslint-config`, `docs`, examples) never ship. */
const PUBLISHED = ['@portqueue/core', '@portqueue/dashboard', '@portqueue/cli'];
const WORKSPACE_FLAGS = PUBLISHED.map((name) => `-w ${name}`).join(' ');

export default {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { breaking: true, release: 'major' },
          { type: 'feat', release: 'minor' },
          { type: '*', release: 'patch' },
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          types: [
            { type: 'feat', section: 'Features' },
            { type: 'fix', section: 'Bug Fixes' },
            { type: 'perf', section: 'Performance Improvements' },
            { type: 'revert', section: 'Reverts' },
            { type: 'deps', section: 'Dependencies' },
            { type: 'refactor', section: 'Code Refactoring' },
            { type: 'docs', section: 'Documentation' },
            { type: 'style', section: 'Styles' },
            { type: 'test', section: 'Tests' },
            { type: 'build', section: 'Build System' },
            { type: 'ci', section: 'Continuous Integration' },
            { type: 'chore', section: 'Miscellaneous Chores' },
          ],
        },
      },
    ],
    [
      '@semantic-release/changelog',
      { changelogFile: 'CHANGELOG.md', changelogTitle: '# Changelog' },
    ],
    [
      '@semantic-release/exec',
      {
        // Refuses a version npm already has before anything is committed, tagged or pushed.
        verifyReleaseCmd: 'node scripts/ci_cd/assert-unpublished.mjs ${nextRelease.version}',
        // Writes the one version into every published package.json, every internal
        // `@portqueue/*` reference between them, and package-lock.json.
        prepareCmd: 'node scripts/ci_cd/set-version.mjs ${nextRelease.version}',
        // dist/ was built and tested earlier in the same job, so this ships exactly what was tested.
        // The dry-run pack prints each tarball's file list into the log before it goes out.
        publishCmd: `npm pack --dry-run ${WORKSPACE_FLAGS} && npm run release`,
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package-lock.json', 'packages/*/package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    ['@semantic-release/github', { successComment: false, failComment: false }],
  ],
};
