# Working with Claude Code — PortQueue

This repo follows the `ai-utils` shared-lib guardrails. Key rules for any AI assistant working here:

## Hard rules
- **Never run package installs** (`npm install`/`ci`, `pnpm`, `yarn`, `bun`). When deps are needed, print the exact command and ask the user to run it.
- **Never auto-commit, push, or publish.** Print the commands; a human runs them. CI is the only actor that publishes.
- **Never create git branches.** Always work on the **current branch**. Only create a branch when the user explicitly asks for it in a prompt — never on your own initiative, and never as a step before committing.
- **Never interactive logins** or anything needing network/credentials — surface the command for the user.
- **Keep the docs in sync with the public API.** Every time the public API of the tool (`@portqueue/core`), the dashboard, or the CLI changes — new/renamed/removed options, methods, DTOs, events, endpoints, or CLI flags — check the Docusaurus site under `docs/` and improve the developer-facing docs if needed (guides, API reference, dashboard/CLI pages, and register any new page in `docs/sidebars.ts`).

## Design invariants
- **Named options over positional args** for any method with >1 input; `data` is a named key.
- **Enums, not magic strings** for states, events, steps, capabilities, error codes, engines, instance types.
- **No `any`** in the public surface; generics carry the payload type end-to-end.
- **Results are objects**, never bare ids.
- **No SQL `JOIN`** anywhere — relationships resolve via separate key-based lookups (NoSQL-portable).
- **Write sharded-DB-safe SQL.** This tool may run on a sharded/distributed database. Do not reach for fancy or engine-specific syntax — prefer the plainest SQL that every supported engine maintains, or check it's compatible across all of them; when unsure, do it "the old way." In particular **no database UPSERT** (`INSERT … ON CONFLICT`, `MERGE`, `INSERT OR REPLACE`, `ON DUPLICATE KEY`): sharded engines reject those unless the conflict target is the shard key. Use a guarded **`UPDATE … RETURNING`, then `INSERT` if it matched nothing** (or a `SELECT`-then-`INSERT` get-or-create where there's no update path). Whenever you pick one SQL approach over another for portability, **say why in a code comment**.
- **Sharded-friendly schema**: no primary keys, unique/check constraints, foreign keys, or indexes — the tool enforces every invariant (name uniqueness, idempotency/singleton dedup) in code. Link rows by **name or key**, never a surrogate id.
- **All SQL values are bound parameters**; identifiers are allowlist-validated and quoted.
- **DB clients are optional peer dependencies**, never runtime deps.
- **Small, focused classes**, one concern each; DI per PortQueue instance.

## Layout
- `packages/core` → `@portqueue/core` (engine + drivers)
- `packages/dashboard` → `@portqueue/dashboard`
- `packages/cli` → `@portqueue/cli`
- `packages/ui` → `@portqueue/ui` (private, never published)
- `packages/eslint-config` → private shared lint base
- `docs/` → Docusaurus site

## Tooling
- Each workspace owns a standalone `tsconfig.json`, `eslint.config.mjs`, `package.json`. No root `extends`.
- Tests: Jest + ts-jest, PGLite + SQLite only, fresh clean DB per suite, injectable clock (no real waiting).
- Conventional commits enforced.
