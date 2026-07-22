# Working with Claude Code — PortQueue

This repo follows the `ai-utils` shared-lib guardrails. Key rules for any AI assistant working here:

## Hard rules
- **Never run package installs** (`npm install`/`ci`, `pnpm`, `yarn`, `bun`). When deps are needed, print the exact command and ask the user to run it.
- **Never auto-commit, push, create branches, or publish.** Print the commands; a human runs them. CI is the only actor that publishes.
- **Never interactive logins** or anything needing network/credentials — surface the command for the user.

## Design invariants
- **Named options over positional args** for any method with >1 input; `data` is a named key.
- **Enums, not magic strings** for states, events, steps, capabilities, error codes, engines, instance types.
- **No `any`** in the public surface; generics carry the payload type end-to-end.
- **Results are objects**, never bare ids.
- **No SQL `JOIN`** anywhere — relationships resolve via separate key-based lookups (NoSQL-portable).
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
