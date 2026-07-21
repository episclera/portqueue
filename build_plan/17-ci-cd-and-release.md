# 17 — CI/CD & Release

GitHub Actions per the `shared-lib-structure` skill (§5): a pipeline owns the npm token; nobody publishes from a laptop. Three workflows requested by the raw plan, plus the automatic changelog.

## 17.1 Workflows

### 1. `ci.yml` — lint + test on every push (every branch)
- Triggers: `push` (all branches) and `pull_request`.
- Steps: `npm ci` → `typecheck` → `lint --max-warnings=0` → `test` (Jest, PGLite + SQLite; coverage gate) → `build` (Vite, all packages, proves the artifacts compile). Runs on the current Node LTS matrix.
- This is the correctness gate for everything; nothing merges red.

### 2. `deploy-docs.yml` — GitHub Pages (main only)
- Triggers: `push` to `main` (path-filtered to `docs/**`, `packages/*/src/**` public API, and shared UI, so API/docs changes redeploy).
- Steps: build `@portqueue/ui` + `docs` → publish `docs/build/` to GitHub Pages via the Pages deploy action. Fully static (file 15.10).
- Name is exactly `deploy-docs` (raw-plan requirement).

### 3. `publish.yml` — npm publish (main only)
- Triggers: release/version event on `main` (see 17.3 for how versioning is driven), not on every push.
- Steps (skill §5 order): `npm ci` → `lint` → `test` → `build` → **publish** the three public packages (`@portqueue/core`, `@portqueue/dashboard`, `@portqueue/cli`) with `--access public`, using the `NPM_TOKEN` **CI secret** (installed by an admin, never held by a developer).
- Publishing is gated on lint+test+build passing. Private packages (`@portqueue/ui`, `eslint-config`) are excluded (`private: true`). There is no separate test-utils package — test helpers live inside `packages/core` and the conformance kit ships as a `@portqueue/core` subpath (file 16).

## 17.2 Automatic changelog (pushed to main, no republish loop)

The raw plan asks for a tool that **generates and pushes the changelog to main but does not trigger a repeated publish.**

- Use **Changesets** (recommended) or a conventional-commits changelog tool. Given commitlint enforces conventional commits (file 01), either works; **Changesets** is recommended because it cleanly separates "version + changelog" from "publish" and handles a monorepo of multiple packages.
- Flow:
  1. Contributors add a changeset (or the tool derives from conventional commits) describing user-facing changes.
  2. A **release workflow** on `main` runs the tool to (a) bump versions, (b) update each package's changelog and the **root `CHANGELOG.md`** (the file the docs footer links to — file 15.3), and (c) create the release/tag.
  3. **Publish is triggered by the tag/release**, and the **changelog commit is marked to skip CI publish** — the version-bump/changelog commit uses a path/`[skip ci]`-style guard (or Changesets' own release PR flow) so committing the changelog back to main does **not** re-trigger `publish.yml` in a loop.
- Net: one deliberate release produces version bump + changelog on main + a single npm publish, with no recursive re-publish.

## 17.3 Versioning

- SemVer. Version is owned by the release tooling/pipeline, never hand-edited on a laptop for a publish.
- The docs header reads the published `@portqueue/core` version (file 15.2); it updates when a release ships.
- Schema migrations are versioned independently of package version but a package release that changes the schema ships the matching migration (file 04.7).

## 17.4 Secrets & tokens

- `NPM_TOKEN` — repository/org Actions secret, installed by admin/DevOps only (skill §5). Used solely by `publish.yml`.
- `GITHUB_TOKEN` — default, used for Pages deploy and pushing the changelog commit.
- No token ever in a `.npmrc` on a developer machine; no `npm publish` by hand.

## 17.5 AI-assistant guardrails in CI context

Per `ai-utils` CLAUDE.md / `project-structure` §12 (copied into this repo's `CLAUDE.md`): the AI never auto-commits, never pushes, never creates branches, never `npm install`s. When a release is due, it prints the exact commands and stops; a human runs them. CI is the only actor that publishes.

## 17.6 Local final-check checklist

- [ ] `ci.yml` runs typecheck+lint+test+build on **every branch/push**.
- [ ] `deploy-docs` deploys the static docs to GitHub Pages on **main only**.
- [ ] `publish.yml` publishes to npm on **main only**, gated on lint+test+build, using an admin-installed `NPM_TOKEN` secret.
- [ ] Automatic changelog updates root `CHANGELOG.md` + per-package changelogs and pushes to main **without** re-triggering publish.
- [ ] Private packages excluded from publish; `--access public` on published ones.
- [ ] No laptop publishing; conventional commits feed the changelog.
