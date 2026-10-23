#!/usr/bin/env node
// Sets one version on every published package — called by release-commit.mjs. It rewrites each
// published package.json's `version`, every reference one published package makes to another
// (dependencies, devDependencies, peerDependencies, optionalDependencies — keeping its `^`/`~`/exact
// prefix), and the matching entries in package-lock.json, so `npm ci` stays in sync with the
// released manifests.
import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGES = {
  '@portqueue/core': 'packages/core',
  '@portqueue/dashboard': 'packages/dashboard',
  '@portqueue/cli': 'packages/cli',
};
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error(`usage: set-version.mjs <semver>, got ${JSON.stringify(version)}`);
  process.exit(1);
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** Bumps `manifest` in place: its version and every internal reference it holds. */
function bump(manifest) {
  manifest.version = version;
  for (const field of DEP_FIELDS) {
    const deps = manifest[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (!(name in PACKAGES)) continue;
      const prefix = /^[\^~]/.exec(deps[name])?.[0] ?? '';
      deps[name] = `${prefix}${version}`;
    }
  }
}

for (const dir of Object.values(PACKAGES)) {
  const file = `${dir}/package.json`;
  const manifest = readJson(file);
  bump(manifest);
  writeJson(file, manifest);
}

const lock = readJson('package-lock.json');
for (const dir of Object.values(PACKAGES)) {
  if (lock.packages?.[dir]) bump(lock.packages[dir]);
}
writeJson('package-lock.json', lock);

console.log(`set ${Object.keys(PACKAGES).join(', ')} to ${version}`);
