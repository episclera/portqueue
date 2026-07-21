# 00 — Vision & Scope

## 00.1 What PortQueue is

PortQueue is a **database-backed job queue for Node.js** that treats the database as the single source of truth and works across *multiple* database engines through a driver abstraction. It ships with first-class drivers for **Postgres, PGLite, SQLite, and Oracle**, and lets developers plug in a **custom driver** for any other engine by implementing one interface.

It is built for teams who already run a relational database and do not want to add Redis (or any other broker) just to get a reliable queue. It aims to be the most **developer-friendly** DB queue in the ecosystem — taking the best ergonomics from `pg-boss` and `BullMQ` and the operational maturity from Celery, while improving on all three.

It is **free and open source, usable commercially with no license obligations** (see [`18-security.md`](./18-security.md) and the tooling file for how this is declared). This position must be stated identically in the README, every `package.json`, and the docs landing page.

## 00.2 Who it is for (primary use cases)

- A backend that needs **background jobs** (emails, webhooks, image processing) without standing up a broker.
- A **horizontally scaled** service deployed to many instances that must cooperate on one queue without double-processing.
- A team that wants **transactional enqueue** — a job is only queued if the surrounding DB transaction commits.
- Teams that want **operational visibility** (a dashboard + CLI) without wiring a third-party service.
- Products that must run on a **customer-chosen database** (some ship Postgres, some Oracle) from one codebase.

## 00.3 Goals

1. **One API across every driver.** The developer writes the same code whether the backend is Postgres or SQLite. Behavioral differences are absorbed by drivers, never leaked into app code. Where a capability truly cannot exist, the method still exists and throws a typed, explanatory error (rare by design).
2. **Developer experience first.** Named-options objects, no positional arguments, importable enums instead of magic strings, strict types with no `any`, results that are objects (never bare ids), and error messages that explain the fix.
3. **Horizontally scalable and instance-agnostic.** Multiple instances cooperate through row-level claiming (`SKIP LOCKED` where available; a safe polling/locking fallback otherwise). No instance assumes it is the only one.
4. **Fault tolerant.** A throwing handler never crashes the worker loop. The system logs everything at the appropriate level and shuts down gracefully.
5. **Minimal footprint.** As few tables as possible, typed columns instead of JSON wherever we control the shape, and no third-party runtime dependencies beyond the raw DB clients — which are **optional peer dependencies**, never auto-installed.
6. **Event-driven and observable.** Every meaningful lifecycle transition emits a typed event and offers participation hooks.
7. **Feature-complete for real workloads.** Concurrency, rate limiting, priorities, delayed jobs, cron/recurring jobs with timezones, idempotency, multi-step jobs, retention/cleanup, system-pressure backpressure, and graceful shutdown.

## 00.4 Non-goals (for v1)

- **Worker threads / child-process execution.** Handlers run on the main event loop in v1. The interfaces (Worker, Job, execution context) are deliberately shaped so a threaded executor can be added later without changing app code — see [`20-roadmap.md`](./20-roadmap.md).
- **BullMQ-style incremental progress.** Explicitly rejected: BullMQ's numeric progress cannot resume from where it left off. PortQueue models resumable work through **multi-step jobs** instead (see [`06`](./06-jobs-scheduling-lifecycle.md)).
- **A hosted service or broker.** PortQueue is a library plus a self-hosted dashboard/CLI. There is no PortQueue server to run (except the optional CLI-launched dashboard host, which is just a thin static+API server).
- **ORM coupling.** We use the raw DB clients only. No ORM, no query builder dependency.
- **Per-job "names" (BullMQ-style).** Explicitly rejected. BullMQ's `queue.add(name, data)` gives each job a *name* used to route to a named processor — in practice this **confuses people, who conflate the job name with the queue name**, and it isn't actually needed: the **queue** is the unit of routing (one worker per queue), a job's *kind* is expressed by which queue it's on, and multi-step routing is handled by the workflow **`StepKey`** (file 06), not a job name. So our `addJob({ data })` takes **no** name. (Correlation/labels that developers genuinely want go in `metadata` or `idempotencyKey`, file 05.) See the rationale in [`05`](./05-public-api.md) §05.8.

## 00.5 Guiding principles (applied everywhere)

- **Named options over positions.** Any method with more than one argument takes one object with meaningful keys.
- **Enums over strings.** States, events, step ids, capabilities, error codes, and instance types are enums exported from the public entry so developers get autocomplete and compile-time safety.
- **Separate concerns in options.** Producer options, queue-definition options, and worker options are distinct types. They never mix in a single bag. (Final-suggestion rule from the raw plan.)
- **Job-level overrides queue-level.** When the same option exists at both the queue and the job, the job value wins.
- **Results are objects.** Producing a job returns a structured result (ids, state, whether it was deduplicated, schedule id for recurring). Never a bare id.
- **Keep it in one table, and never `JOIN`.** Favor keeping data on the `job` row; when a relationship must be followed (even `job`→`queue`), resolve it with a **separate key-based lookup**, never a relational join — on *any* engine, hot or cold. Many target engines join poorly, and we intend to support **NoSQL/document** stores that have no join at all. See the **no-join rule** in [`04`](./04-data-model-and-migrations.md) §04.1.
- **Typed columns, not JSON** — except the developer's own payload, which is inherently opaque and stored as the engine's native JSON type (JSONB/JSON) or TEXT where none exists.
- **Small, focused classes.** Class-first with typedi DI. Each concern (pub/sub, scheduling, claiming, monitoring, migration, retention…) is its own service in its own folder. No long files.
- **Instance-agnostic always.** Assume N copies are running. Never rely on in-process state for correctness of claiming, scheduling, or dedup.
- **Explain the "why" in docs.** When we pick an approach over an alternative (e.g. multi-step over numeric progress), the docs say why.

## 00.6 What we take from prior art (and where we improve)

The raw plan asks us to weigh pg-boss, BullMQ, and Celery and take the best. Concrete decisions:

**From pg-boss (Postgres-native queue):**
- The insight that a relational DB with `SKIP LOCKED` + LISTEN/NOTIFY is enough for a robust queue — no broker needed.
- Singleton/throttling and scheduled jobs as first-class concepts.
- *Improvements:* pg-boss is Postgres-only and its API mixes many positional/overloaded signatures. PortQueue is multi-driver, uses strict named-options everywhere, minimizes tables further, avoids JSON for our own bookkeeping columns, and returns rich result objects.

**From BullMQ (Redis queue):**
- The clean **producer/consumer split** (`Queue` produces, `Worker` consumes) so "send jobs here, process jobs there" is a first-class deployment shape.
- Flow/parent-child ideas inform our multi-step design.
- Per-worker concurrency and a rate limiter.
- *Improvements:* we drop numeric progress in favor of resumable multi-step; we are DB-backed (durable, transactional, queryable with SQL) rather than Redis-backed; every option is named.

**From Celery (Python task queue):**
- Operational maturity: retries with backoff, rate limits, scheduled/periodic tasks (beat), visibility timeouts, and the notion of *acks late* (a job isn't considered done until the handler confirms) — which maps to our claim/lock + visibility-timeout model.
- The importance of good introspection tooling (Celery's `flower`) — our dashboard + CLI.
- *Improvements:* strict typing end-to-end, no separate result backend to configure (results live in the same DB), and a single API across engines.

## 00.7 Glossary (used consistently across all files)

- **Driver** — an adapter that implements the PortQueue `Driver` interface for one database engine. Owns all SQL and engine-specific behavior.
- **Capability** — a boolean/enum flag a driver exposes describing what the engine supports (e.g. `LISTEN_NOTIFY`, `SKIP_LOCKED`, `RETURNING`). Core code branches on capabilities, never on driver identity.
- **PortQueue (client)** — the top-level object bound to one driver. Owns the connection, migrations, shared services, and produces `Queue` and `Worker` handles.
- **Queue** — a named channel and the **producer** handle for it (add/schedule/inspect jobs). A queue name also identifies the job type.
- **Worker** — the **consumer** side: claims jobs for one queue and runs the handler(s). Distinct object so producing and consuming can live on different servers.
- **Job** — one unit of work: a row in the `job` table, and the context object passed to a handler.
- **Handler** — the developer's function that processes a job (a single function, or one handler per step in a **workflow**).
- **Workflow (multi-step job)** — an ordered set of steps where each step is its own `job` row sharing a `workflow_id`; completing a step spawns the next. Resumable and crash-safe (file 06).
- **Schedule (recurring/cron)** — a definition that repeatedly produces *new* jobs. Each produced job is distinct but shares a `schedule_id`.
- **Idempotency key** — a caller-supplied key that prevents inserting duplicate jobs.
- **Instance** — one running process/container of the consuming application. Identified for attribution (container id vs bare-metal product uuid).
- **Visibility timeout / lock** — the window during which a claimed job is invisible to other instances; if it expires without completion the job is considered *stalled* and reclaimable.

## 00.8 Deliverables (what "done" means)

- `packages/core` → `@portqueue/core` — the library + bundled first-party drivers.
- `packages/dashboard` → `@portqueue/dashboard` — the pluggable React dashboard middleware.
- `packages/cli` → `@portqueue/cli` — the command-line tool.
- `packages/ui` → `@portqueue/ui` — shared theme/components, **`private: true`, never published**. Consumed at build time and bundled into the docs site and dashboard only; external users never install it directly. See [`14`](./14-ui-and-design-system.md).
- `docs/` — the Docusaurus site deployed to GitHub Pages.
- CI/CD: lint+test on every push (every branch), deploy-docs on main, npm publish on main, automatic changelog.
- A test suite targeting high coverage using PGLite + SQLite only.
