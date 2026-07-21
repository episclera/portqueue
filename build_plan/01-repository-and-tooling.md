# 01 — Repository & Tooling

This project is a **shared library monorepo** and follows the `ai-utils` `shared-lib-structure` skill (which inherits `project-structure`). This file records only the PortQueue-specific decisions and the parts of those skills that matter most here. Where this file is silent, the skills are the source of truth.

## 01.0 First step — scaffold from the `ai-utils` shared-lib skill

> **AI agents:** do not run `npm install`/`ci`/`pnpm`/`yarn`/`bun` yourself at any point in this file. Generate the files, then **print the exact install/build command and wait for the user to run it and confirm** before continuing (README → "Execution rules for an AI agent").

Before anything below, the implementer **applies the `../ai-utils` `shared-lib-structure` skill** to scaffold the repo (raw plan line 8: *"Use ../ai-utils shared-lib ai skill to setup that lib"*). Concretely: read `../ai-utils/skills/shared-lib-structure/SKILL.md` and its dependency `../ai-utils/skills/project-structure/SKILL.md`, then create the root tooling (npm workspaces, `.nvmrc`, Prettier, ESLint base, Husky, commitlint, `.vscode/settings.json`), the `packages/*` + `docs/` layout, and copy the "Working with Claude Code" guardrails into this repo's `CLAUDE.md`. The rest of this file layers PortQueue's product-specific choices on top of that scaffold. **Check `npm view` for the latest stable of every dependency before pinning** (skill version policy).

## 01.1 Repository layout

```
portqueue/
  packages/
    core/                 → @portqueue/core        (the library + first-party drivers)
    dashboard/            → @portqueue/dashboard    (pluggable React dashboard middleware)
    cli/                  → @portqueue/cli          (command-line tool)
    ui/                   → @portqueue/ui           (private, never published — shared theme + components; see file 14)
    eslint-config/        → private, never published (shared flat ESLint base)
  docs/                   Docusaurus static site (its own workspace)
  .github/workflows/      CI/CD (lint-test, deploy-docs, publish, changelog)
  scripts/
    dev/                  setup, start_all
    ci_cd/                build/publish helpers invoked by Actions
  .husky/                 git hooks
  .changeset/ (or equiv)  changelog/version tooling state (see file 17)
  package.json            workspaces + delegating scripts (root)
  .prettierrc, .prettierignore, commitlint.config.js, .nvmrc, .editorconfig, .vscode/settings.json
  README.md               product README (contributions guide + docs links)
  LICENSE                 the super-open license (see below)
```

- **No `apps/*`, no `libs/*`.** This is a shared library: publishable code lives under `packages/*`, docs under `docs/`. (Skill §0.1.)
- Each workspace owns its **own standalone** `tsconfig.json`, `eslint.config.mjs`, `jest.config.*`, and `package.json`. No root `tsconfig extends`. (Skill §1.1.)
- The root `package.json` `workspaces` globs are `["packages/*", "docs"]`.

### Folder name vs published name
The scope is the **project** (`@portqueue`), not the org. Folder `core` publishes as `@portqueue/core`, folder `dashboard` as `@portqueue/dashboard`, etc. (Skill §3.)

## 01.2 Packages and their responsibilities

| Folder | npm name | Published? | Responsibility |
|--------|----------|-----------|----------------|
| `packages/core` | `@portqueue/core` | yes (public) | Queue engine, driver model, first-party drivers, events, scheduler, monitor, migrations |
| `packages/dashboard` | `@portqueue/dashboard` | yes (public) | React dashboard + framework middleware adapters; consumes a `PortQueue` instance |
| `packages/cli` | `@portqueue/cli` | yes (public) | CLI for stats/actions and for serving the dashboard |
| `packages/ui` | `@portqueue/ui` | **no** (`private: true`) | Shared AntD theme tokens + design primitives, bundled into dashboard & docs at build time |
| `packages/eslint-config` | — | **no** (`private: true`) | Shared flat ESLint base re-exported by every workspace |

**Exactly these five folders live under `packages/` — `core`, `dashboard`, `cli`, `ui`, `eslint-config` — and no others.** There is **no `packages/testing` package**: tests live **inside each package** (co-located `*.test.ts` / `__tests__/` under that package's `src/`). Shared internal test helpers (clean-DB `createTestQueue`, fake clock, fixtures) live in `packages/core` under a non-published test-utils folder; the **driver conformance kit** external authors need is shipped as a `@portqueue/core` subpath export (`@portqueue/core/conformance`). See file 16.

Rationale for splitting `core` from `dashboard`/`cli`: a production backend installs only `@portqueue/core` (small, zero React). The dashboard and CLI are opt-in operational tools. See files 12–13.

## 01.3 Build tool — Vite (library mode)

Per the skill, build every publishable package with **Vite in library mode**.

- **`@portqueue/core`**: entry `src/index.ts`. Emit **ESM + CJS** so both `import` and `require` consumers work (the raw plan asks for "simple js and mjs and other build types as needed"). Emit `.d.ts` via `vite-plugin-dts`.
  - **Subpath exports for drivers.** Drivers must be importable individually so that importing the SQLite driver never pulls in Oracle's peer client. Provide subpath exports (see 01.6). The bundler externalizes each DB client library.
  - Externalize all peer dependencies (the DB clients) in `rollupOptions.external`.
- **`@portqueue/dashboard`**: builds two artifacts — (a) the server/middleware entry (Node ESM+CJS) and (b) the client bundle (static JS/CSS assets the middleware serves). React and AntD are peer/externalized where appropriate; the client bundle is self-contained static assets.
- **`@portqueue/cli`**: Node build with a `bin` entry; ESM primary.
- **`@portqueue/ui`**: ESM library, React/AntD externalized. **`private: true`** — built for consumption by the docs site and dashboard within the repo, never published to npm.

Keep all other tooling (ESLint flat config, Prettier, Jest, standalone tsconfig) exactly as the skills prescribe.

## 01.4 TypeScript

- TypeScript latest stable (skill floor is TS 6+; verify with `npm view typescript version` before pinning).
- `engines.node` set to the current active LTS range; `.nvmrc` matches. **Check `npm view` before pinning** any dependency version — the skill's numbers are a floor, not a target.
- **`strict: true`** everywhere. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` on. Public surface must not use `any`; use generics, `unknown`, and discriminated unions.
- `declaration: true`, `declarationMap: true` so consumers can jump to types.

## 01.5 Lint / format / test / hooks

- ESLint 9 flat config; shared base in `packages/eslint-config` (private), re-exported per workspace with local overrides. `no-explicit-any` is an **error** in `packages/core/src/**` public surface (relax to warn in tests).
- Prettier at the root; `.prettierrc` + `.prettierignore` global.
- Husky: `pre-commit` → lint-staged (Prettier on staged files); `commit-msg` → commitlint (conventional commits — required, because the changelog tool derives from them; see file 17).
- Jest + ts-jest per workspace. Coverage focus and rules in [`16-testing-strategy.md`](./16-testing-strategy.md).

## 01.6 `package.json` exposure for `@portqueue/core`

The contract with consumers. Key requirements:

- `main` → `./dist/index.cjs`, `module` → `./dist/index.mjs`, `types` → `./dist/index.d.ts`. Never point at `src`.
- An **`exports` map** with the root plus **per-driver subpaths**, so consumers import exactly the driver they use:
  - `"."` → the core API (client, queue, worker, enums, errors, types).
  - `"./drivers/postgres"`, `"./drivers/pglite"`, `"./drivers/sqlite"`, `"./drivers/oracle"` → each driver as its own entry, each declaring its DB client as a peer.
  - `"./conformance"` → the driver conformance test kit (file 16) so custom-driver authors can validate against the contract. (The internal `test-utils` folder is **not** exported and is excluded from `files`.)
  - Each subpath has `types`/`import`/`require` conditions.
- `files` whitelists `dist/` + `README` + `LICENSE`. Verify with `npm pack --dry-run`.
- **`peerDependencies` + `peerDependenciesMeta`** list every DB client (`pg`, `@electric-sql/pglite`, `better-sqlite3` or `node:sqlite`, `oracledb`) as **optional** peers. They are never runtime `dependencies`; the consumer installs only the one for their DB. (Raw plan: no auto-installing third-party libs for the dev.)
- `publishConfig.access: "public"`.
- `sideEffects: false` to help tree-shaking (the driver subpaths make this safe).
- `version` and publishing are owned by the pipeline, never a laptop (skill §5).

The same `exports`/`files`/`publishConfig` discipline applies to the other **published** packages, `@portqueue/dashboard` and `@portqueue/cli`. (`@portqueue/ui` is `private: true` and never published — it needs no `publishConfig`.)

## 01.7 Zero-third-party-runtime-deps policy

- `@portqueue/core` has **no runtime `dependencies`** beyond, at most, a tiny well-justified utility (prefer Node built-ins: `node:crypto` for UUIDs where the DB can't generate them, `node:perf_hooks` for the monitor, `node:events` for the emitter). Any exception must be justified in the PR and recorded in file 20.
- DB clients are optional peers (01.6).
- Cron parsing: implement a small internal cron parser (5/6-field + timezone) rather than adding a dependency, unless review decides a vetted zero-dep parser is safer — decide in file 06. Timezone math uses `Intl`/`Temporal` (Node built-in) — no `moment`/`luxon` runtime dep.

## 01.8 License

A **maximally permissive** license so commercial use needs no obligations. Recommended: **MIT** (universally understood, zero friction) or **BlueOak / 0BSD / Unlicense** if the intent is "no attribution required." Recommendation: **MIT** for familiarity, or **0BSD** if the owner truly wants *no* conditions at all. Whichever is chosen:
- Put it in root `LICENSE`, reference it in every published `package.json` (`"license": "MIT"`), and state it plainly on the docs landing page and README: *"Free and open source. Commercial use permitted. No license fee, no obligations."*
- The decision must be identical everywhere; a mismatch is a final-check failure.

## 01.9 Scripts & README

- `scripts/dev/setup` — idempotent one-shot: nvm use, `npm ci`, copy any example env, build packages in dependency order (`ui` → `core` → `dashboard`/`cli` → `docs`), and run any local bootstrap. When an AI agent runs the plan it **prints this command and waits for the user to run it and confirm** — it never auto-installs on the AI's behalf (skill guardrail; README execution rules).
- `scripts/dev/start_all` — runs the docs dev server and/or a dashboard example concurrently.
- Root `README.md` follows the standard shape (skill §10) **plus** what the raw plan requires: a contributions guide (or link to `CONTRIBUTING.md`), and prominent links/description pointing to the docs site. Keep conventions in `ai-utils`, not duplicated here.

## 01.10 Local final-check checklist

- [ ] Every workspace has standalone `tsconfig`, `eslint.config.mjs`, `package.json`; no root `extends`.
- [ ] `@portqueue/core` exposes per-driver subpath exports; importing one driver does not require another's peer client.
- [ ] Every DB client is an **optional peer dependency**, never a runtime dependency; nothing auto-installs.
- [ ] `npm pack --dry-run` shows only `dist/`, README, LICENSE for each published package.
- [ ] ESM + CJS + `.d.ts` all emitted for `@portqueue/core`.
- [ ] License is permissive, present in `LICENSE`, and stated identically in all `package.json`, README, and docs landing.
- [ ] Conventional commits enforced (changelog depends on it).
