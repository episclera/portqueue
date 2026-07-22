---
id: contributing
title: Contributing
sidebar_label: Contributing
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
by commitlint) — the changelog is derived from them.

Tests use **PGLite + SQLite only**, so they run anywhere with no external DB server. If
you need a real Postgres or Oracle (e.g. for manual driver testing), start one in Docker:

```bash
npm run db:pg:up       # Postgres   (stop with db:pg:down)
npm run db:oracle:up   # Oracle     (stop with db:oracle:down)
```

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
  [conformance kit](./drivers/custom.md).
- Be kind — a standard code of conduct applies.

Meet the people behind it on the [Team](./team.mdx) page.
