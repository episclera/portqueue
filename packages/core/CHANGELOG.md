# @portqueue/core

## [1.0.2](https://github.com/episclera/portqueue/compare/core-v1.0.1...core-v1.0.2) (2026-10-23)


### Code Refactoring

* rename the Postgres driver to PostgreSQL ([ac56aa0](https://github.com/episclera/portqueue/commit/ac56aa0f83e82f2698ef6660d9dbeaa85017e134))

## [1.0.1](https://github.com/episclera/portqueue/compare/core-v1.0.0...core-v1.0.1) (2026-10-20)


### Miscellaneous Chores

* **core:** Synchronize portqueue versions

## 1.0.0

### Minor Changes

- 7f0cfee: Initial implementation of PortQueue: a database-backed job queue for Node.js with one API across Postgres, MySQL, Oracle, PGLite, and SQLite.

  - `@portqueue/core`: queue engine, driver model + first-party drivers, cron/interval scheduling, retries/backoff, idempotency/singleton, delayed jobs + expiry, rate limiting, system-pressure backpressure, retention, events + hooks, transactional enqueue with adapters, and a shipped driver conformance kit.
  - `@portqueue/dashboard`: framework-agnostic middleware (Node/Express/Koa/Fastify) + React SPA with live updates.
  - `@portqueue/cli`: monitor and operate a PortQueue instance loaded from your own config module, and serve the dashboard.

  Every duration in the API is a **whole number of seconds**, named with a `Seconds` suffix
  (`expireInSeconds`, `retry.delaySeconds`, `limiter.lockDurationSeconds`, `schedule.startEverySeconds`,
  `shutdown({ timeoutSeconds })`, …). There is no duration-string parsing, so `'1m'` can't be mistaken
  for a month, and there is exactly one option per setting — a delay is `schedule.startAfterSeconds`,
  with no absolute-`Date` alternative (subtract if you have an instant). Cron expressions are parsed by
  `cron-parser`, which adds names (`MON`) and the `L`/`#`/`W`/`?` specials on top of the 5- and 6-field
  forms.

  The `v1` schema stores those durations in integer `*_seconds` columns. Since nothing has been
  published yet, `v1` was edited in place rather than superseded — **drop any pre-existing development
  database** (e.g. the PGLite dirs under `tmp/`) so it is recreated with the current schema.
