# Changesets

This folder holds [Changesets](https://github.com/changesets/changesets) state. It drives
versioning, per-package changelogs, and the root `CHANGELOG.md`, and separates the
version-bump commit from the npm publish so committing the changelog back to `main` does not
re-trigger a publish loop.

To record a user-facing change:

```bash
npx changeset
```

Private packages (`@portqueue/ui`, `@portqueue/eslint-config`, `@portqueue/docs`) are ignored
and never published.
