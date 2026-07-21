# PortQueue — Build Plan

This folder is a **complete, implementation-ready specification** for PortQueue. It is written so that an AI agent (or a human team) can pick it up and build the whole project — the `@portqueue/core` library, its database drivers, the dashboard, the CLI, the shared UI, the documentation site, the CI/CD pipelines, and the test suite — without needing to re-derive the design.

It intentionally does **not** contain the finished source code. It describes *what* to build and *why*, down to method signatures, option shapes, table columns, event names, folder layouts, and design rationale. Deep code samples are avoided on purpose; where a method or type is described, the implementer chooses the exact code, but the **public shape is fixed here** so the whole system stays coherent.

## Execution rules for an AI agent (read first)

If you are an AI agent (Claude or otherwise) implementing this plan, follow these operating rules:

- **Never auto-run dependency installs.** Do **not** run `npm install` / `npm ci` / `pnpm install` / `yarn` / `bun install` (or any package-manager add/install command) yourself. When a step needs dependencies installed, **stop, print the exact command(s) for the user to run, and wait for the user to confirm** they've completed it before continuing. The agent's environment can't be relied on to install packages (no/partial network, auth, peer-dep choices), so the user runs these manually.
- **Same for any other command you can't reliably perform** — interactive logins (`npm login`, `gcloud auth login`), anything needing network/credentials, or long-running/interactive processes. Surface the command, ask the user to run it, and wait for confirmation rather than assuming success.
- **Prefer generating files and edits** (source, config, docs) — that is the agent's job. Shell side effects that touch the network or the user's credentials are the user's to run.
- When you do hand off a command, give the **precise** invocation (including the package names and the target workspace/directory) so the user can paste and run it without guessing.

## How to read this plan

Read in order. Each file assumes the ones before it. The first five files are the load-bearing design decisions; everything after applies them.

| # | File | What it locks down |
|---|------|--------------------|
| — | [`README.md`](./README.md) | This index + the global final-check checklist |
| 00 | [`00-vision-and-scope.md`](./00-vision-and-scope.md) | Product vision, goals, non-goals, guiding principles, glossary, lessons taken from pg-boss / BullMQ / Celery |
| 01 | [`01-repository-and-tooling.md`](./01-repository-and-tooling.md) | Monorepo layout, packages, Vite builds, tsconfig, lint/format/test, `package.json` exports |
| 02 | [`02-core-architecture.md`](./02-core-architecture.md) | typedi DI, service decomposition, `packages/core` folder tree, runtime lifecycle |
| 03 | [`03-driver-model.md`](./03-driver-model.md) | The `Driver` interface, capability flags, LISTEN/NOTIFY vs polling, `SKIP LOCKED`, custom drivers |
| 04 | [`04-data-model-and-migrations.md`](./04-data-model-and-migrations.md) | Tables, columns, indexes, per-DB deviations, the auto-migration/versioning mechanism |
| 05 | [`05-public-api.md`](./05-public-api.md) | **The developer-facing interface** — `PortQueue`, `Queue`, `Worker`, `Job`, every method and option object |
| 06 | [`06-jobs-scheduling-lifecycle.md`](./06-jobs-scheduling-lifecycle.md) | Job states, delays, cron/every scheduling, priority, idempotency, retention, workflows (multi-step), retries/backoff |
| 07 | [`07-concurrency-scaling-rate-limiting.md`](./07-concurrency-scaling-rate-limiting.md) | Concurrency, rate limiting, horizontal scaling, system-pressure monitor, graceful shutdown |
| 08 | [`08-events-and-hooks.md`](./08-events-and-hooks.md) | Event enums, the event bus, participation hooks vs observation events |
| 09 | [`09-transactions.md`](./09-transactions.md) | Transactional enqueue, passing an external transaction/connection |
| 10 | [`10-observability-logging-errors.md`](./10-observability-logging-errors.md) | Logger contract, fault tolerance, error taxonomy, actionable error messages |
| 11 | [`11-drivers-reference.md`](./11-drivers-reference.md) | Per-driver detail: Postgres, PGLite, SQLite, Oracle + peer-dependency policy |
| 12 | [`12-dashboard.md`](./12-dashboard.md) | `@portqueue/dashboard` — the pluggable middleware, pages, data API, auth |
| 13 | [`13-cli.md`](./13-cli.md) | `@portqueue/cli` — commands, flags, dashboard-serving, docker usage |
| 14 | [`14-ui-and-design-system.md`](./14-ui-and-design-system.md) | `@portqueue/ui` — the shared theme + components used by both docs and dashboard |
| 15 | [`15-docs-site.md`](./15-docs-site.md) | Docusaurus site: information architecture, landing page, blog, search, theming, per-driver code tabs |
| 16 | [`16-testing-strategy.md`](./16-testing-strategy.md) | Jest strategy, coverage focus, PGLite/SQLite-only test drivers, timing rules, security tests |
| 17 | [`17-ci-cd-and-release.md`](./17-ci-cd-and-release.md) | GitHub Actions: lint/test, deploy-docs, npm publish, automatic changelog |
| 18 | [`18-security.md`](./18-security.md) | Security-by-default, injection prevention, dashboard/CLI auth, security test plan |
| 19 | [`19-usage-examples.md`](./19-usage-examples.md) | Worked end-to-end scenarios mapped to the exact API methods they need |
| 20 | [`20-roadmap.md`](./20-roadmap.md) | Deferred features (worker threads, more drivers) and how today's interfaces leave room for them |

## Conventions used throughout

- **Package scope** is `@portqueue/*`. Folder names under `packages/` may differ from the published name (e.g. folder `core` → package `@portqueue/core`), per the `shared-lib-structure` skill.
- This project follows the `ai-utils` `shared-lib-structure` skill (which inherits `project-structure`). Where this plan and that skill agree, the skill is the source of truth for tooling; where this plan adds product-specific rules, this plan governs the product.
- **No positional parameters** for anything with more than one argument — every such method takes a single options object with named properties. This is a hard rule, restated in file 05 and enforceable in review.
- **No magic strings** in the public surface — job states, events, step identifiers, driver capabilities, and error codes are all TypeScript enums that consumers can import.
- **Methods are named after the entity they act on.** Every public method contains the noun of the thing it operates on: **job** methods → `addJob`, `addJobs`, `getJob`, `getJobs`, `retryJob`, `cancelJob`, `cancelRunningJob`, `removeJob`, `removeJobs`, `purgeJobs`; **queue** methods → `createQueue`, `pauseQueue`, `resumeQueue`, `getQueues`, `getQueueStats`; **worker** methods → `createWorker`; **schedule** methods → `removeSchedule`, `getSchedules`. The only allowed omission: controls on a *scoped handle* whose receiver already **is** that entity may drop the word (e.g. `queue.pause()`/`queue.resume()` on a `Queue` handle). New methods must follow this rule — never a bare `add`/`retry`/`remove`.
- **Strict typing, no `any`** in the public surface. Generics carry the job payload type end-to-end.

## Global final-check checklist

Run this after the whole system is built, and again after any change to the public surface. (Each file also ends with its own local checklist.)

- [ ] **API coherence** — every method that takes >1 argument uses a named-options object; no positional surprises. Method names read the same across `PortQueue`, `Queue`, and `Worker`.
- [ ] **Enum coverage** — no user-facing string literal that should be an importable enum (states, events, steps, capabilities, error codes, instance types).
- [ ] **Driver parity** — every public method behaves identically across drivers, or throws a typed `UnsupportedCapabilityError` with a documented workaround. No silent divergence.
- [ ] **Same-shape results** — producing a job always returns a result object (never a bare id), and recurring producers always include the schedule/repeat id.
- [ ] **Horizontal safety** — every claim/mutation path is safe under N concurrent instances (`SKIP LOCKED` or the documented polling fallback); nothing assumes a single process.
- [ ] **Fault tolerance** — no handler error can crash the worker loop; everything is logged at the right level; shutdown is graceful.
- [ ] **Producer/consumer split** — job options, queue options, and worker options are separate types that never bleed into each other.
- [ ] **Docs ↔ code** — every public method, event, option, and driver capability is documented in the Docusaurus site; per-driver code tabs indicate when behavior is identical vs different.
- [ ] **Design shared** — dashboard and docs draw from the one `@portqueue/ui` theme; they visibly belong to the same product.
- [ ] **License clarity** — every published `package.json`, the README, and the docs landing page state the free/open, no-license-needed-for-commercial-use position identically.
- [ ] **Security** — all SQL is parameterized/identifier-escaped; the dashboard/CLI ship with an auth story; security tests exist.
- [ ] **Peer-dependency hygiene** — no database driver library is a hard dependency; each is an optional peer the consumer installs for the DB they chose.
