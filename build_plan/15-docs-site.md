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
  - **Docs:** Getting Started, Core Concepts, API Reference, Dashboard, CLI.
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
4. **Producing Jobs** — add, bulk, options, priority, delay, idempotency/singleton, transactional enqueue.
5. **Consuming Jobs** — workers, concurrency, handlers, rate limiting, error handling & retries/backoff.
6. **Scheduling** — delayed jobs, cron & every, timezones, schedule ids.
7. **Multi-step Jobs** — the step machine, resumability, why not numeric progress (with the rationale).
8. **Events & Hooks** — full reference of every event and hook phase with use cases (dedicated pages — raw-plan requirement).
9. **Transactions** — managed + adopt-external, per driver, notify-after-commit.
10. **Drivers** — the driver model, per-driver pages (capabilities, peer install, gotchas), writing a **custom driver** + the conformance kit.
11. **Scalability** — a focused section on horizontal scaling: SKIP LOCKED, visibility timeout, cluster-coordinated scheduling/retention, instance-agnostic design, and **how scalable it is / the techniques used** (raw-plan emphasis).
12. **Performance & Optimization** — connection pooling tips, index/retention tuning, batch/concurrency tuning, poll-interval vs LISTEN latency, "how to optimize the connection," per-driver perf notes (raw-plan: "always tell how to optimize").
13. **Dashboard** — mounting (CLI-served **first**, then Express/Koa/Fastify/raw Node), securing with basic auth + custom auth, docker usage, screenshots (placeholders per file 14.7).
14. **CLI** — commands, flags, `listen`, serving the dashboard, docker.
15. **Migrations & Versioning** — auto/manual/validate modes, upgrading versions.
16. **Security** — security-by-default, injection safety, dashboard/CLI auth, what we test (file 18).
17. **API Reference** — generated/curated reference of every public method, option, result, enum (kept in sync with file 05).
18. **Troubleshooting** — keyed by `PortQueueErrorCode` (file 10.4).
19. **Contributing** — how to contribute, dev setup, conventions link to `ai-utils`, code of conduct (raw-plan: contributions page).

"Why we chose X over Y" call-outs are sprinkled where a non-obvious decision was made (multi-step vs progress, few tables, no broker, notify-after-commit).

## 15.7 Landing page (beautiful, marketing-quality)

- Hero: logo + tagline, the **free & open-source, commercial-use, no-license** message front and center, primary CTA (Get Started) + GitHub (new tab).
- Feature grid with icons: multi-driver, no broker needed, horizontally scalable, transactional, cron/scheduling, multi-step, rate limiting & backpressure, dashboard + CLI, strictly typed.
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
5. *"Resumable multi-step jobs (and why we skipped numeric progress)"* — the step machine, a real use case (an order-processing pipeline).

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
