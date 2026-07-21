# 12 — Dashboard (`@portqueue/dashboard`)

A self-hostable React dashboard that plugs into the developer's existing Node HTTP server (raw Node, Express, Koa, Fastify) as **middleware** — shipped like a GraphQL Playground: you mount it and it's served. It talks to a **`PortQueue` instance the developer provides**; it never opens its own DB connection.

> **Naming:** the raw plan sometimes calls this the "monitor" / "monitoring" package. It is the **`@portqueue/dashboard`** package — "monitor package" in the raw plan (e.g. "shared theme config with the monitor package") means this dashboard. The `SystemMonitorService` in core (file 07) is a different thing (host backpressure), not this package.

## 12.1 Model

- The developer already has a running `PortQueue` (the same one their app uses, or a read-scoped one). They pass that instance to the dashboard factory. The dashboard uses the client's read APIs (`getStats`, `getJobs`, `getQueues`, `getJob`) and control methods (`pause`, `resume`, `retry`, `remove`, `add`, bulk ops) plus event subscriptions for live updates.
- **No second DB connection, no separate credentials for data access** — it rides on the provided instance. (The only auth is to protect the *dashboard endpoint itself*, see 12.5.)

## 12.2 Package shape

`packages/dashboard/` produces two things:

1. **Server/middleware** (`@portqueue/dashboard`, Node ESM+CJS): framework adapters + a JSON API + a static-asset server.
2. **Client** (built React app, static assets shipped inside the package `dist/`): the SPA the middleware serves.

Folder sketch:
```
packages/dashboard/src/
  server/
    create-dashboard.ts        Factory returning a framework-agnostic handler
    adapters/
      express.ts  koa.ts  fastify.ts  node.ts   Thin per-framework wrappers
    api/
      routes.ts                JSON endpoints backing the SPA (list queues, jobs, stats, actions, event stream)
      auth.ts                  Pluggable auth guard (see 12.5)
      serialize.ts             Maps PortQueue snapshots → wire DTOs (typed, shared with client)
    assets.ts                  Serves the built client bundle + index.html
  client/                      React app (AntD + @portqueue/ui theme)
    pages/  components/  queries/  ...   (page structure per project-structure §8)
  shared/
    dto.ts                     Wire types shared by server api + client (single source of truth)
```

## 12.3 Mounting API (developer-facing)

Single named-options factory (no positional args):

- `createDashboard(options: DashboardOptions)` → returns an object with per-framework handlers.
  - `DashboardOptions`: `{ portQueue: PortQueue; basePath?: string (default '/portqueue'); auth?: DashboardAuth; readOnly?: boolean; title?: string; theme?: 'light'|'dark'|'system' }`.
  - `readOnly: true` disables all mutating actions (view-only deployments).
- Usage shape per framework (documented in file 15):
  - Express/Koa: `app.use(basePath, dashboard.express())` / `.koa()`.
  - Fastify: `app.register(dashboard.fastify(), { prefix })`.
  - Raw Node: `dashboard.node()` returns a `(req, res) => boolean` you call in your request handler.
- The factory is the only entry; framework choice is a method on the result, so the surface stays tiny and consistent.

## 12.4 Pages & layout

Design shares the `@portqueue/ui` theme with the docs (file 14) so dashboard and docs are visibly one product. AntD components throughout.

**Responsive & mobile-friendly (design requirement).** The dashboard **must be fully responsive** and usable on phones/tablets — an operator often checks queues or pauses a queue from their phone during an incident. Design mobile-first and keep it in mind for every page:
- KPI cards stack, the per-queue and jobs tables switch to a card/stacked layout (or horizontal-scroll with sticky key columns) on narrow viewports — no clipped, unusable grids.
- Navigation and filters collapse into a drawer/menu; primary actions (pause/resume, retry, add) remain reachable with finger-sized tap targets; nothing depends on hover.
- Graphs/sparklines and forms reflow to fit; long ids/values truncate with copy affordances.
- Uses the shared `@portqueue/ui` responsive breakpoints (file 14) so it behaves consistently with the docs.

**Overview (home)** — the "at a glance" page:
- Top KPI cards: totals for `ACTIVE / RETRY / FAILED / STALLED / COMPLETED` across all queues, plus jobs/min throughput and failure rate.
- A **per-queue table**: name, counts by state, throughput sparkline, paused indicator, quick actions (pause/resume, open).
- A **throughput graph** (jobs completed/failed over time) and a **jobs-per-instance** breakdown (using `run_on_instance_id`/`type` — shows which servers/containers did the work, split by container vs bare-metal).
- Global search (jump to a job by id / idempotency key).

**Queue detail page** (`/queues/:name`):
- State counts + graphs scoped to the queue.
- A filterable, paginated **jobs table** (filter by state, schedule id, date; cursor paging via `getJobs`).
- Controls: **pause/resume** (with `PauseMode` choice — stop handling vs stop accepting), **add a job** (a form building `AddJobOptions`), **purge** by state.
- Schedules panel: list recurring definitions, their next run, enable/disable, unschedule.
- **Bulk actions** on selected jobs: retry, remove, cancel.

**Job detail page** (`/jobs/:id`):
- Full record: status, attempts, priority, instance attribution, the **`failure_message`** (message with stack, when failed), timings, and the schedule id link.
- **Job lifecycle timeline** — a compact vertical timeline built from the job's lifecycle timestamps (`created_at → started_at → completed_at` / `failed_at` / `cancelled_at` / `expired_at`, with `retried_at` and `stalled_at` markers and the attempt count). It reads as "what happened to this job, and when," showing the **duration between transitions** and the current status at the head. This renders for **every** job (single-function or multi-step).
- **Per-step history** (multi-step jobs) — a step-by-step view from `steps_history` in **execution order**: one row/segment **per run**, each showing the step id, an outcome badge (running / completed / failed), `started_at` → `completed_at`/`failed_at` with **duration**, **expandable** `data` (input) and `return_value` JSON, and the `failure_message` on failure. Because `steps_history` is append-only, a step that **repeated or was retried shows as repeated rows**, so the real execution path is visible — not just the latest. Steps declared on the worker but not yet run render as **pending**, and a header shows progress (e.g. "3 / 5 steps completed") against the worker's declared `steps`. Presented as a readable timeline/stepper (mobile: a stacked list), not a raw JSON dump.
- Actions: **retry** — with a `RetryMode` choice: **from the failed step** (default, resume where it stopped) or **from the start** (re-run the whole job); for single-function jobs the choice collapses to one. Plus **clone** (open the add-job form pre-filled from this job's data/options), **remove**, and for recurring, link to the schedule and its sibling runs. (No arbitrary-step picker — file 06.8.1.)

_(PortQueue does not store handler logs — there is no log column and no `job.log()`; use your own logger/console, files 04/05.)_

**Schedules page** — all recurring definitions across queues, with next-run, timezone, and CRUD.

All destructive/mutating actions are hidden entirely in `readOnly` mode and gated by auth otherwise; each shows a confirm dialog.

## 12.5 Security / auth

- Auth protects the **dashboard endpoint**, not the DB (the DB is reached only through the provided instance).
- `DashboardAuth` is pluggable: `{ mode: 'none' | 'basic' | 'custom'; ... }`.
  - `basic` — HTTP Basic with configured username/password (hashed compare); the CLI-served dashboard uses this (file 13, "ask for root username/password").
  - `custom` — a developer-supplied `(req) => Promise<boolean | AuthResult>` guard so they can reuse their app's session/JWT/SSO.
  - `none` — only sensible behind an already-protected network; docs warn loudly.
- Docs (file 15) include a worked example of protecting the mount with Express basic-auth middleware **and** with the built-in `auth` option.
- `readOnly` + auth compose: a common setup is authenticated read-only for most, full control for admins (custom guard returns a role).
- All action endpoints are CSRF-safe (same-origin checks / token) and require the mutating capability; input is validated server-side against the same option schemas as core.

## 12.6 Live updates

- The API exposes an event stream (SSE, no dep) the client subscribes to; the server bridges `PortQueueEvent`s to the stream, filtered by what the current page needs.
- The client also polls the read APIs on an interval to reconcile (events accelerate, DB is truth — file 08).

## 12.7 Branding

- Uses the shared `@portqueue/ui` theme and the **AI-generated SVG logo** (file 14) in its header, matching the docs site, so the two feel built for the same project.

## 12.8 Local final-check checklist

- [ ] Mounts as middleware on raw Node / Express / Koa / Fastify from one `createDashboard(options)` factory (named options only).
- [ ] Uses the provided `PortQueue` instance; never opens its own DB connection or asks for DB creds.
- [ ] Overview, queue-detail, job-detail, schedules pages exist with the specified stats, graphs, and instance attribution.
- [ ] Job detail shows a **lifecycle timeline** (every job) and a **per-step run history** from `steps_history` (multi-step) — execution order, repeats/retries visible, durations, expandable input/return, pending steps + progress.
- [ ] Add / clone / retry / remove / cancel / purge and **bulk actions**; pause supports "stop handling" vs "stop accepting".
- [ ] Pluggable auth (basic/custom/none) + `readOnly`; destructive actions gated + confirmed; endpoints CSRF-safe and input-validated.
- [ ] Live updates via event stream with DB reconciliation.
- [ ] Shares `@portqueue/ui` theme + logo with docs.
- [ ] **Fully responsive & mobile-friendly**: mobile-first; tables→stacked/scroll, nav→drawer, actions reachable with finger-sized tap targets; verified on phone-width viewports.
