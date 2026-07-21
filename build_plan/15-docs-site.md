# 15 — Documentation Site (`docs/`, Docusaurus)

A beautiful, developer-friendly documentation site built with **Docusaurus**, deployed to **GitHub Pages** (`deploy-docs` workflow, main only — file 17). It shares the `@portqueue/ui` theme and logo (file 14) so it matches the dashboard. This file specifies information architecture, the landing page, blog, search, chrome (header/footer), the per-driver code-tab component, and cross-cutting rules.

## 15.1 Tech & structure

- Docusaurus (latest v3+), TypeScript config, MDX content. Its own workspace under `docs/` (in the root `workspaces` globs).
- Brand applied via Docusaurus theme customization + swizzled components, with tokens from `@portqueue/ui`. Custom interactive components (code tabs, callouts, landing sections) use AntD + `antd-style` under a `ConfigProvider` (file 14.6).
- Content lives in `docs/docs/**` (guide) and `docs/blog/**` (blog), images in `docs/static/img/**` (+ shared assets from `@portqueue/ui`).

## 15.2 Header (top of every page)

- **Left:** the PortQueue **logo** (the AI-generated SVG from `@portqueue/ui`, file 14.5) — clicking returns home.
- **Center:** the **search input** — light-grey background, soft shadow, **no hard border** (raw-plan styling). Prominent, centered.
- **Right:** the current **version** (read from `@portqueue/core`'s published version), a **theme switcher** (light/dark/system, file 14.4), and a **GitHub link** that opens the repo in a **new tab** (use an inline GitHub SVG icon — no external image fetch; placeholder icon acceptable per file 14.7 if needed).

## 15.3 Footer (every page, light colors)

- Uses light background colors (raw-plan requirement) — a soft, low-contrast palette from the shared tokens.
- Deduced link columns:
  - **Docs:** Getting Started, Core Concepts, Production Best Practices, API Reference, Dashboard, CLI.
  - **Resources:** Blog, Events reference, Performance & Optimization, Scalability, Troubleshooting.
  - **Project:** GitHub (new tab), **Changelog** (links to the `CHANGELOG.md` in the repo root — file 17), Contributing, License.
  - A line restating: *free & open source, commercial use, no license needed.*

## 15.4 In-page chrome (every doc page)

- **Left sidebar:** all topics/subtopics, ordered **by priority/importance**, split into meaningful sections (15.6) — never a flat list, never topic-hopping.
- **Right sidebar (TOC):** the current page's headings/subheadings.
- **Bottom nav:** **Previous** and **Next** page buttons, and between them a **"Report an issue / found something wrong?"** button that opens our **GitHub issues** page in a **new tab** (prefilled with the page path where possible).
- **Related pages** at the end: a curated set of links (driven by a per-page config mapping → related pages), so readers move laterally through related topics.
- **Mentions as links:** whenever the prose mentions another concept/page/external tool, it's a link; **external links open in a new tab** (raw-plan requirement). A remark/rehype plugin enforces `target="_blank" rel="noopener"` on external links.

## 15.5 Code examples — per-driver / per-manager tabs (a hard requirement)

Every code example is **not a bare code card** — it's a **tabbed card**:
- For DB-specific examples: one tab per driver (**Postgres / PGLite / SQLite / Oracle**). If the code is identical across drivers, show a **single tab clearly labeled "All databases"** (explicitly indicate sameness rather than hiding it).
- For installation and package-manager examples: tabs per **package manager** (npm / pnpm / yarn / bun) and per driver where relevant, each showing the exact `install` + client peer command (file 11.6).
- Syntax-highlighted (Docusaurus Prism, TypeScript grammar). A reusable `<CodeTabs>` MDX component (backed by `@portqueue/ui`) standardizes this so authors just supply the per-tab snippets and a "same for all?" flag.

## 15.6 Information architecture (left sidebar, ordered by priority)

Split meaningfully; each section flows logically without jumping topics.

1. **Introduction** — what PortQueue is, the free/OSS/no-license statement, when to use it, comparison with pg-boss/BullMQ/Celery (the "why choose this").
2. **Getting Started** — install (tabbed, per driver + manager), connect, first queue, first worker, first job — a smooth onboarding path (raw-plan "dev-friendly introduction process").
3. **Core Concepts** — client/queue/worker model, job lifecycle & states, at-least-once & idempotency, producer/consumer split.
4. **Producing Jobs** — add, bulk, options, priority, delay, idempotency/singleton, transactional enqueue. Includes a **"jobs have no name" callout** — unlike BullMQ's `add(name, data)`, PortQueue jobs carry no per-job name (routing is the queue's role; it's a common source of queue-name confusion and isn't needed — use `metadata`/`idempotencyKey` for labels/correlation).
5. **Consuming Jobs** — workers, **concurrency & parallelism** (how N handlers run in parallel, why there's no head-of-line blocking within a queue, tuning `concurrency`/`batchSize`), handlers, rate limiting, error handling & retries/backoff.
6. **Scheduling** — delayed jobs, cron & every, timezones, schedule ids. Makes clear that **scheduling is the `schedule` option on `add`** (one method for one-off and recurring — no separate `schedule()`), and **unscheduling is `remove({ scheduleId })`** (no separate `unschedule()`).
7. **Workflows (multi-step jobs)** — a **dedicated top-level section** (not a single page), because workflows are a headline feature and the model is non-obvious. Its pages, in order (each with per-driver `<CodeTabs>` and a "why we chose this" callout):
   1. *What a workflow is* — the mental model: an ordered set of steps where **each step is its own job row** sharing a `workflowId`, completing a step **spawns** the next step's job. Contrast with BullMQ numeric progress (why not) and why this resumes.
   2. *Designing a workflow* — how to **design** one well: define a `StepKey` enum, order the `steps` array (entry step first), write one handler per step, keep handlers **idempotent** (at-least-once), decide what each step passes forward via `step.next({ data })`, and where to `repeat`/`done`. Guidance on step granularity (each step = one crash-safe unit of external side effect), naming, and avoiding hidden cross-step state.
   3. *Defining & sharing the definition* — `defineWorkflow({ queue, steps })` as the single source of truth imported by **both** the producer tier (`pq.createQueue(definition)`) and the worker tier (`pq.createWorker(definition)`); the produce-here/consume-there split for workflows. Emphasize that **starting a run is just `add({ data })`** — a workflow queue differs from a simple queue only in that its worker has many steps instead of one handler.
   4. *The step controller* — `step.next({ to?, data? })` (advance; next key computed from declared order or an explicit jump), `step.repeat({ data?, delayMs? })`, `step.done({ result? })` — with a full worked pipeline example (validate → charge → ship → notify, file 19.7).
   5. *Resumability, retries & data flow* — how a crash mid-step is reclaimed and re-run; per-step retry/backoff; what carries over vs resets when the next step is spawned (the 04.2 carry-over rules, in plain language); each step's input is `job.data`.
   6. *Inspecting & retrying runs* — `getWorkflow({ workflowId })`, the dashboard run view, and `RetryMode` (`FROM_FAILED_STEP` vs `FROM_START`), with the rationale for no arbitrary-step selector (06.8.1).
8. **Events & Hooks** — full reference of every event and hook phase with use cases (dedicated pages — raw-plan requirement). Leads with an **"Events vs Hooks — when to use which"** page: the decision rule (react-after-can't-change → event; run-before/around-and-maybe-change/block → hook), the comparison table, and the three things only hooks can do (mutate the outgoing job, veto/skip by throwing, be awaited/transactional) — so readers don't assume `on`/`off` makes `useHook` redundant (file 08 §08.0).
9. **Transactions** — managed + adopt-external, per driver, notify-after-commit.
10. **Drivers** — the driver model, per-driver pages (capabilities, peer install, gotchas), writing a **custom driver** + the conformance kit.
11. **Scalability** — a focused section on horizontal scaling and parallelism: **how jobs run in parallel** (per-worker concurrency) and **how queues stay independent** (per-queue claim loops, `queue_id`-scoped claiming, no cross-queue blocking — a job never waits on another queue), SKIP LOCKED, visibility timeout, cluster-coordinated scheduling/retention, instance-agnostic design, and **how scalable it is / the techniques used** (raw-plan emphasis). Includes the connection-pool caveat and the "separate instances for hard isolation" pattern (file 07.2b).
12. **Performance & Optimization** — connection pooling tips, index/retention tuning, batch/concurrency tuning, poll-interval vs LISTEN latency, "how to optimize the connection," per-driver perf notes (raw-plan: "always tell how to optimize").
13. **Production Best Practices** — a **capstone, cross-linked "production readiness" guide**: the one page an operator reads before shipping. It doesn't re-teach features; it collects the *right defaults and habits* and links to the deep pages. Sections:
    - *Deployment topology* — split producers (API tier, no `createWorker`) from consumers (worker tier); run critical vs bulk workloads as **separate `PortQueue` instances / pools** for hard isolation (file 07.2b); wire the same config module across tiers (file 04.5 persistence rule).
    - *Migrations on deploy* — do **not** auto-migrate in prod: prefer `MigrationMode.MANUAL`/`VALIDATE_ONLY` and run `portqueue migrate` as a **separate, single deploy step** before rolling app instances; how upgrades/version bumps roll out (file 04.7).
    - *Graceful shutdown* — install `SIGTERM`/`SIGINT` handlers that call `pq.shutdown({ graceful: true, timeoutMs })`, honor `job.signal` in long handlers, and set drain timeouts to your platform's grace period (file 07.6); the recommended snippet.
    - *Connection pool sizing* — size for the **sum of worker concurrencies** + headroom for claim/heartbeat/notify traffic; keep handler transactions short so one queue can't starve the shared pool (files 07.2b / Performance).
    - *Reliability & idempotency* — assume **at-least-once**: make handlers idempotent, use `idempotencyKey`/`singletonKey`, and design workflow steps as idempotent units (files 06.2 / 06.6 / Workflows).
    - *Retries & backoff* — set sane `retryMaxAttempts`, exponential backoff **with jitter** and a cap, and `dontAutoretryFor` for non-retryable errors; failed jobs stay in `job` (status `FAILED`) for triage and manual `retry` — there is no dead-letter queue (file 06.4).
    - *Retention* — the default is keep-forever; **turn on `DELETE_AFTER` retention** (or your own pruning) so `job` doesn't grow unbounded; keep failed jobs longer than completed (file 06.9).
    - *Backpressure & rate limits* — enable the `SystemMonitor` (event-loop/CPU/memory thresholds) and set queue/worker rate limits for third-party APIs; how these compose (files 07.4 / 07.5).
    - *Observability* — structured logging with correlation via `metadata`, **subscribe to `PortQueueEvent.ERROR`** so nothing is silent, export metrics/tracing through hooks, and use instance attribution for per-server stats (files 08 / 10 / 07.3).
    - *Security* — protect the dashboard/CLI with auth, set `maxPayloadBytes`, and rely on parameterized queries (never string-built SQL); link to the Security section (file 18).
    - *Health checks & readiness* — expose readiness via `pq.isRunning` + a lightweight driver ping; don't accept traffic until `init()` resolved.
    - *Scaling & fairness* — scale consumers horizontally (no leader election needed), pin `instance.id` where a stable identity matters, and use per-tier queues if strict priority/fairness is required (files 07.2 / 07.3 / 07.7).
    - A copy-pasteable **production checklist** at the end (each item linking to its section).
14. **Dashboard** — mounting (CLI-served **first**, then Express/Koa/Fastify/raw Node), securing with basic auth + custom auth, docker usage, screenshots (placeholders per file 14.7).
15. **CLI** — commands, flags, `listen`, serving the dashboard, docker.
16. **Migrations & Versioning** — auto/manual/validate modes, upgrading versions.
17. **Security** — security-by-default, injection safety, dashboard/CLI auth, what we test (file 18).
18. **API Reference** — generated/curated reference of every public method, option, result, enum (kept in sync with file 05).
19. **Troubleshooting** — keyed by `PortQueueErrorCode` (file 10.4).
20. **Contributing** — how to contribute, dev setup, conventions link to `ai-utils`, code of conduct (raw-plan: contributions page).

"Why we chose X over Y" call-outs are sprinkled where a non-obvious decision was made (workflows-as-separate-jobs vs numeric progress, no per-job names, few tables, no broker, notify-after-commit).

## 15.7 Landing page (beautiful, marketing-quality)

- Hero: logo + tagline, the **free & open-source, commercial-use, no-license** message front and center, primary CTA (Get Started) + GitHub (new tab).
- Feature grid with icons: multi-driver, no broker needed, horizontally scalable, transactional, cron/scheduling, resumable workflows, rate limiting & backpressure, dashboard + CLI, strictly typed.
- A short "at a glance" code sample (tabbed) showing add + worker.
- A scalability highlight strip (ties to §11).
- Social-proof / comparison teaser linking to the comparison page and blog.
- Footer as in 15.3.

## 15.8 Blog (statically generated, ≥5 initial posts)

Docusaurus blog. At least **5 initial posts** (raw-plan), e.g.:
1. *"Why we built a broker-less, database-native job queue"* — the vision & when DB-backed beats Redis.
2. *"PortQueue vs pg-boss vs BullMQ vs Celery"* — honest comparison, where each shines, why PortQueue's multi-driver + typing + transactional enqueue matter.
3. *"Transactional job enqueue: killing the dual-write bug"* — the transactions feature as a story.
4. *"Scaling to N instances with SKIP LOCKED and visibility timeouts"* — the scalability techniques.
5. *"Resumable workflows (and why we skipped numeric progress)"* — each step as its own job, spawning the next; a real use case (an order-processing pipeline).

Posts use the tabbed code component and link out (new tab) to references.

## 15.9 Search (no third-party service)

- Investigate and default to a **local, self-hosted search** that needs no external SaaS: the community **`@easyops-cn/docusaurus-search-local`** (offline/local index, builds at compile time, no server) is the recommended default. Avoid Algolia DocSearch (external service) to satisfy "avoid third-party services." Record the choice and its build-time indexing in the docs "why" note.
- The search box is the centered header input (15.2).

## 15.10 Deployment

- `deploy-docs` GitHub Action builds the static site and publishes `docs/build/` to GitHub Pages, **on main only** (file 17). Fully static — no server.

## 15.11 Responsive & mobile-friendly (design requirement)

The docs site **must be fully responsive and mobile-friendly** — this is a first-class design constraint, considered from the start, not retrofitted:
- **Mobile-first**: every page (landing, guide, blog, API reference) reads and navigates cleanly on phones and tablets, not just desktop. Design and review each layout at small breakpoints first, then scale up.
- The sidebar collapses to a drawer, the right-side TOC hides/relocates, and the header (logo + search + version + theme switcher + GitHub) reflows to a compact mobile bar on narrow viewports.
- **Code tabs / `CodeTabs`**, callouts, tables, and landing-page sections stay usable on small screens (horizontal scroll for wide code, wrap for prose; no fixed widths that overflow).
- Tap targets are finger-sized; nothing depends on hover; text stays legible without zoom.
- Shared tokens/components from `@portqueue/ui` (file 14) provide the responsive breakpoints so docs and dashboard behave consistently.

## 15.12 Local final-check checklist

- [ ] Header: logo left, centered borderless shadowed search, right-side version + theme switcher + GitHub (new tab).
- [ ] Footer on every page with light colors and the deduced columns incl. Changelog → repo `CHANGELOG.md`.
- [ ] Left sidebar ordered by priority + right-side TOC; prev/next + report-issue (opens GitHub issues, new tab); related links at page end.
- [ ] Every code example is tabbed per driver (or clearly "All databases"); install examples tabbed per manager/driver.
- [ ] Dedicated pages for all events/hooks and for performance/optimization; a strong scalability section.
- [ ] External mentions are links opening in new tabs.
- [ ] Landing page states free/OSS/no-license; ≥5 blog posts incl. comparisons; local (non-SaaS) search.
- [ ] Getting Started gives a smooth onboarding path; Contributing page present.
- [ ] Uses shared `@portqueue/ui` theme + AI-generated SVG logo; image placeholders where assets are pending.
- [ ] **Fully responsive & mobile-friendly**: mobile-first layouts; sidebar→drawer, TOC + header reflow; code tabs/tables usable on phones; finger-sized tap targets; verified at small breakpoints.
