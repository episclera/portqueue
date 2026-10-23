#!/usr/bin/env node
// Cuts a release as one commit: picks the next version from the Conventional Commits since the last
// release commit, writes it into every published package (set-version.mjs), prepends those commits
// to the root CHANGELOG.md, and commits the lot as `chore(release): x.y.z [skip ci]`. That is all it
// does — pushing and publishing are the workflow's next steps (production.yml).
//
// There are no tags. The previous release is the newest `chore(release): …` commit on the branch,
// and the current version is what that commit wrote into the packages, so git history is the only
// state. A tag would add nothing: going back is a revert PR or a fix merged on top, never a re-point.
//
// Bump: `!` or a `BREAKING CHANGE:` footer → major, `feat` → minor, every other type → patch.
// `--dry-run` prints the version and the changelog entry and writes nothing.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const CHANGELOG = 'CHANGELOG.md';
const CHANGELOG_TITLE = '# Changelog';
const VERSION_SOURCE = 'packages/core/package.json';
const RELEASE_SUBJECT = /^chore\(release\): \d+\.\d+\.\d+/;
const HEADER = /^(?<type>\w+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<subject>.+)$/;
const REVERT_HEADER = /^Revert "(?<subject>.+)"$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: ([\s\S]+)/m;

/** Changelog sections, in the order they're written. A type not listed here is still released. */
const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance Improvements'],
  ['revert', 'Reverts'],
  ['deps', 'Dependencies'],
  ['refactor', 'Code Refactoring'],
  ['docs', 'Documentation'],
  ['style', 'Styles'],
  ['test', 'Tests'],
  ['build', 'Build System'],
  ['ci', 'Continuous Integration'],
  ['chore', 'Miscellaneous Chores'],
];
const OTHER_SECTION = 'Other Changes';

const dryRun = process.argv.includes('--dry-run');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The newest release commit reachable from HEAD, or `undefined` before the first release. */
function lastReleaseCommit() {
  for (const line of git('log', '--format=%H %s').split('\n')) {
    const [sha, ...subject] = line.split(' ');
    if (RELEASE_SUBJECT.test(subject.join(' '))) return sha;
  }
  return undefined;
}

/** Every non-merge commit since `from` (all history when absent), newest first, parsed. */
function commitsSince(from) {
  const range = from ? [`${from}..HEAD`] : [];
  const out = git('log', '--no-merges', '--format=%H%x1f%B%x1e', ...range);
  return out
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, message] = entry.split('\x1f');
      return parse(sha, message.trim());
    })
    .filter(Boolean);
}

/** A Conventional Commit (or a GitHub `Revert "…"` commit); anything else isn't released. */
function parse(sha, message) {
  const [header] = message.split('\n');
  if (RELEASE_SUBJECT.test(header)) return undefined;
  const revert = REVERT_HEADER.exec(header);
  if (revert) return { sha, type: 'revert', subject: revert.groups.subject, breaking: [] };
  const match = HEADER.exec(header);
  if (!match) return undefined;
  const { type, scope, bang, subject } = match.groups;
  const footer = BREAKING_FOOTER.exec(message)?.[1].trim();
  const breaking = footer ? [footer] : bang ? [subject] : [];
  return { sha, type, scope, subject, breaking };
}

function nextVersion(current, commits) {
  const [major, minor, patch] = current.split('-')[0].split('.').map(Number);
  if (commits.some((commit) => commit.breaking.length > 0)) return `${major + 1}.0.0`;
  if (commits.some((commit) => commit.type === 'feat')) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** `https://github.com/<owner>/<repo>`, from the published package's `repository.url`. */
function repoUrl() {
  const { repository } = readJson(VERSION_SOURCE);
  const url = typeof repository === 'string' ? repository : repository?.url;
  return url?.replace(/^git\+/, '').replace(/\.git$/, '');
}

function changelogEntry(version, commits) {
  const repo = repoUrl();
  const date = new Date().toISOString().slice(0, 10);
  const line = (commit, text = commit.subject) => {
    const scope = commit.scope ? `**${commit.scope}:** ` : '';
    const short = commit.sha.slice(0, 7);
    const link = repo ? `[${short}](${repo}/commit/${commit.sha})` : short;
    return `* ${scope}${text} (${link})`;
  };

  const blocks = [`## ${version} (${date})`];
  const breaking = commits.flatMap((commit) => commit.breaking.map((note) => line(commit, note)));
  if (breaking.length > 0) blocks.push(`### ⚠ BREAKING CHANGES\n\n${breaking.join('\n')}`);

  const known = new Set(SECTIONS.map(([type]) => type));
  for (const [title, members] of [
    ...SECTIONS.map(([type, title]) => [title, commits.filter((commit) => commit.type === type)]),
    [OTHER_SECTION, commits.filter((commit) => !known.has(commit.type))],
  ]) {
    if (members.length > 0)
      blocks.push(`### ${title}\n\n${members.map((c) => line(c)).join('\n')}`);
  }
  return blocks.join('\n\n');
}

function prependToChangelog(entry) {
  const body = readFileSync(CHANGELOG, 'utf8').replace(CHANGELOG_TITLE, '').trimStart();
  writeFileSync(CHANGELOG, `${CHANGELOG_TITLE}\n\n${entry}\n\n${body}`.trimEnd() + '\n');
}

/** Tells the workflow what happened, so the push, publish and docs steps run only on a release. */
function report(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
}

const commits = commitsSince(lastReleaseCommit());
if (commits.length === 0) {
  console.log('nothing to release: no Conventional Commits since the last release commit');
  report({ released: 'false' });
  process.exit(0);
}

const version = nextVersion(readJson(VERSION_SOURCE).version, commits);
const entry = changelogEntry(version, commits);
if (dryRun) {
  console.log(`next version: ${version}\n\n${entry}`);
  process.exit(0);
}

// Refuses a version npm already has before anything is written or committed.
execFileSync('node', ['scripts/ci_cd/assert-unpublished.mjs', version], { stdio: 'inherit' });
execFileSync('node', ['scripts/ci_cd/set-version.mjs', version], { stdio: 'inherit' });
prependToChangelog(entry);
git('add', CHANGELOG, 'package-lock.json', 'packages/*/package.json');
git('commit', '-m', `chore(release): ${version} [skip ci]`);
console.log(`committed release ${version}`);
report({ released: 'true', version });
