#!/usr/bin/env node
// Fails the release when any published package already has this version on npm — called by
// semantic-release's verifyRelease step (release.config.mjs). That step runs before prepare, so a
// taken version stops the run before the release commit and tag are pushed; without it, npm only
// refuses at publish, after both are already on main.
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
      `Tag the commit that holds the highest published version as v<that version> so the next release starts above it.`,
  );
  process.exit(1);
}
console.log(`${version} is free for ${PACKAGES.join(', ')}`);
