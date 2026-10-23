#!/usr/bin/env node
// Fails the release when any published package already has this version on npm — called by
// release-commit.mjs before it writes anything, so a taken version stops the run before a release
// commit exists; without it, npm only refuses at publish, after that commit is already on main.
import { execFileSync } from 'node:child_process';

const PACKAGES = ['@portqueue/core', '@portqueue/dashboard', '@portqueue/cli'];

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error(`usage: assert-unpublished.mjs <semver>, got ${JSON.stringify(version)}`);
  process.exit(1);
}

/** Whether `name@version` is on the registry; a package that was never published is not. */
function isPublished(name) {
  try {
    return (
      execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim() !== ''
    );
  } catch (error) {
    if (String(error.stderr ?? '').includes('E404')) return false;
    throw error;
  }
}

const taken = PACKAGES.filter(isPublished);
if (taken.length > 0) {
  console.error(
    `${taken.map((name) => `${name}@${version}`).join(', ')} already on npm. ` +
      `Run set-version.mjs with the highest published version and commit it as "chore(release): <that version>" so the next release starts above it.`,
  );
  process.exit(1);
}
console.log(`${version} is free for ${PACKAGES.join(', ')}`);
