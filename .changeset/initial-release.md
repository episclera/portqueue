---
'@portqueue/core': minor
'@portqueue/dashboard': minor
'@portqueue/cli': minor
---

Initial implementation of PortQueue: a database-backed job queue for Node.js with one API across Postgres, Oracle, PGLite, and SQLite.

- `@portqueue/core`: queue engine, driver model + first-party drivers, workflows (multi-step, resumable), cron/interval scheduling, retries/backoff, idempotency/singleton, delayed jobs + expiry, rate limiting, system-pressure backpressure, retention, events + hooks, transactional enqueue with adapters, and a shipped driver conformance kit.
- `@portqueue/dashboard`: framework-agnostic middleware (Node/Express/Koa/Fastify) + React SPA with live updates, pluggable auth, and server-enforced read-only mode.
- `@portqueue/cli`: monitor and operate a PortQueue instance loaded from your own config module, and serve the dashboard.
