---
'@portqueue/core': minor
'@portqueue/dashboard': minor
'@portqueue/cli': minor
---

Initial implementation of PortQueue: a database-backed job queue for Node.js with one API across Postgres, MySQL, Oracle, PGLite, and SQLite.

- `@portqueue/core`: queue engine, driver model + first-party drivers, workflows (multi-step, resumable), cron/interval scheduling, retries/backoff, idempotency/singleton, delayed jobs + expiry, rate limiting, system-pressure backpressure, retention, events + hooks, transactional enqueue with adapters, and a shipped driver conformance kit.
- `@portqueue/dashboard`: framework-agnostic middleware (Node/Express/Koa/Fastify) + React SPA with live updates, pluggable auth, and server-enforced read-only mode.
- `@portqueue/cli`: monitor and operate a PortQueue instance loaded from your own config module, and serve the dashboard.

Every duration in the API is a number of **seconds**, named with a `Seconds` suffix
(`expireInSeconds`, `retry.delaySeconds`, `limiter.lockDurationSeconds`, `schedule.startEverySeconds`,
`shutdown({ timeoutSeconds })`, …). There is no duration-string parsing, so `'1m'` can't be mistaken
for a month. Cron expressions are parsed by `cron-parser`, which adds names (`MON`) and the `L`/`#`/`W`/`?`
specials on top of the 5- and 6-field forms.

The `v1` schema stores those durations in `*_seconds` float columns. Since nothing has been published
yet, `v1` was edited in place rather than superseded — **drop any pre-existing development database**
(e.g. the PGLite dirs under `tmp/`) so it is recreated with the current schema.
