---
id: contributing
title: Contributing
sidebar_label: Contributing
description: Contribute to PortQueue — set up the monorepo, run the build and test suite on PGLite and SQLite, follow the conventions, and open issues and PRs.
keywords: [portqueue, contributing, open source, monorepo, node.js, typescript, drivers, conformance kit]
---

# Contributing

PortQueue is free and open source, and contributions are welcome.

## Dev setup

It's an npm-workspaces monorepo:

```bash
git clone https://github.com/episclera/portqueue
cd portqueue
./scripts/dev/setup.sh   # or: npm run setup
```

`setup.sh` selects the pinned Node version and installs all workspaces — that's all you
need to get the repo ready. Then:

```bash
npm run build      # build every package
npm test           # test suite (PGLite + SQLite — no external services needed)
npm run lint       # ESLint + `tsc --noEmit` in one step
```

Commits follow **[Conventional Commits](https://www.conventionalcommits.org)** (enforced
by commitlint) — the changelog *and the version* are derived from them. Releases are cut by
[semantic-release](https://github.com/semantic-release/semantic-release): every push to `main` is a
release, with no release PR to merge. It publishes `@portqueue/core`, `@portqueue/dashboard` and
`@portqueue/cli` together at one shared version and records it in the
[changelog](https://github.com/episclera/portqueue/blob/main/CHANGELOG.md). Every commit type is
releasable: `feat:` ships a minor, `!` (or a `BREAKING CHANGE:` footer) a major, and anything else
(`fix:`, `refactor:`, `docs:`, …) a patch — so reserve `!` for real breaks of the public API.

**Automated tests run on PGLite + SQLite only**, so they need no external DB server. Both are
in-process, so the whole suite — the conformance kit included — runs anywhere; and because PGLite *is*
PostgreSQL compiled to WASM, the PostgreSQL SQL is exercised by inheritance too.

**MySQL and Oracle are verified by hand.** Their SQL is authored in their own dialects and no
in-process engine can exercise it, so a change to either driver isn't finished until you've run the
[conformance kit](./advanced.md#validate-with-the-conformance-kit) against a real server:

```ts
import { runConformance } from '@portqueue/core/conformance';
import { MysqlDriver } from '@portqueue/core/drivers/mysql';

runConformance({
  name: 'mysql',
  createDriver: () => new MysqlDriver({ connectionString: process.env.DATABASE_URL }),
});
```

Start one in Docker. Each engine has an `npm run` script and an equivalent shell script under
`scripts/dev/db/` — use whichever you prefer:

```bash
npm run db:postgresql:up          # or: ./scripts/dev/db/start-postgresql.sh   (stop: db:postgresql:down)
npm run db:mysql:up       # or: ./scripts/dev/db/start-mysql.sh      (stop: db:mysql:down)
npm run db:oracle:up      # or: ./scripts/dev/db/start-oracle.sh     (stop: db:oracle:down)
```

There are also runnable [example apps](./examples.md) under `examples/` (dashboard servers,
job scheduling) — a quick way to exercise the library locally. See the
[Examples](./examples.md) page for how to run each one.

Packages:

- `packages/core` → `@portqueue/core` — the library + bundled first-party drivers.
- `packages/dashboard` → `@portqueue/dashboard` — the pluggable React dashboard.
- `packages/cli` → `@portqueue/cli` — the command-line tool.
- `packages/ui` → `@portqueue/ui` — shared theme/components (private, never published).
- `docs/` → this Docusaurus site.

## Conventions

- **Named options everywhere** — any method with more than one input takes one options object.
- **Enums, not magic strings** — for states, events, step keys, capabilities, error codes.
- **Strict types, no `any`** — payload types flow through generics.
- **Small, focused classes**; explain the "why" in docs when a non-obvious choice is made.

## Filing issues & PRs

- Open issues and PRs on [GitHub](https://github.com/episclera/portqueue). Include a
  minimal repro for bugs.
- New behavior needs tests; a driver contribution should pass the
  [conformance kit](./advanced.md#validate-with-the-conformance-kit) — against a real server for
  MySQL and Oracle, and say so in the PR.
- Be kind — a standard code of conduct applies.

Meet the people behind it on the [Team](./team.mdx) page.

## Working on the UI

When implementing anything user-facing — the dashboard, docs, or shared `@portqueue/ui`
components — consult the [Brandbook](./brandbook.mdx) first. It's the source of truth for the
palette, typography, iconography, tone, and component style, so contributions stay visually
consistent. Icons come from `@portqueue/ui`'s curated `src/icons.ts` re-export of
`@ant-design/icons` — never emoji, and never a direct import of the icon package.
