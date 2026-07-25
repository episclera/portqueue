# Idempotency & singleton dedup

Shows the two per-queue deduplication guards:

- **`idempotencyKey`** — first-writer-wins. A later add with the same key returns the *existing*
  job (`result.deduplicated === true`) instead of inserting a duplicate.
- **`singletonKey`** — at most one active-ish (PENDING/ACTIVE/RETRY) job per key at a time.

Backed by PGLite under the repo-root `tmp/` folder — nothing external to install or start.

```bash
npm run example:idempotency      # from the repo root
# or, from this folder:
npm start
```
