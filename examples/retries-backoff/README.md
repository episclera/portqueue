# Retries & backoff

Shows how a job retries after a failing handler, using `retry.maxAttempts`, `retry.delay`, and a
`backoff` strategy (fixed or exponential, with jitter). Backed by PGLite under the repo-root `tmp/`
folder — nothing external to install or start.

```bash
npm run example:retries          # from the repo root
# or, from this folder:
npm start
```

The handler throws on its first two attempts and succeeds on the third; watch the exponential
delay grow between attempts.
