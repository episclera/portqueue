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
npm install
npm run build      # build every package
npm test           # test suite (PGLite + SQLite — no external services needed)
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
- The [test suite](https://github.com/episclera/portqueue) targets high coverage using
  PGLite + SQLite only, so it runs anywhere with no services.

## Filing issues & PRs

- Open issues and PRs on [GitHub](https://github.com/episclera/portqueue). Include a
  minimal repro for bugs.
- New behavior needs tests; a driver contribution should pass the
  [conformance kit](./drivers/custom.md).
- Be kind — a standard code of conduct applies.

Meet the people behind it on the [Team](./team.mdx) page.
