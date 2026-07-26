# `@portqueue/dashboard` — improvements & fixes

A review of the dashboard package (server middleware + client SPA) as of `c1955ab`.
Items marked **[confirmed]** were verified against the source or reproduced; the rest are
judgement calls / gaps.

Ordering is by severity within each section, not by effort.

---

## 1. Bugs

### 1.1 Live updates never fire from the event stream **[confirmed]**

`LiveProvider` only sets `es.onmessage` (`client/components/LiveProvider.tsx:49`), which the
EventSource spec fires **only for events whose type is `message`** — i.e. frames with no
`event:` line. Every frame the server sends is named:

- `engine.ts:75` → `event: ready`
- `routes.ts:405` → `event: JOB_ADDED` / `JOB_FAILED` / …

So `onmessage` is never invoked and `pulse` never advances from SSE. The whole SSE pipeline is
dead weight: the UI silently degrades to the 30s poll, and every action's "refresh after
mutation" comes from `refreshNow()` alone.

Fix either side:

- client: `for (const e of STREAMED_EVENTS) es.addEventListener(e, handler)`, or
- server: drop the `event:` line and send only `data:` (loses per-event filtering).

Prefer the client fix and share the event list — the client can't import the `@portqueue/core`
barrel (see `client/queries/enums.ts`), so the names need mirroring in `shared/` the way
`JobStatus` already is.
(comment - drop the support for SSE use just long pooling 30s implementation, for every page have it's own list of active/important queries and long pool only these, for example for overview/queue pages only the cards and table queries, for jobs page only the jobs query and so on )

### 1.2 `GET /api/schedules` registers every queue in the dashboard's process **[confirmed]**

`routes.ts:245` loops `portQueue.createQueue(name)` over **every queue in the database** to read
its schedules. `createQueue` is not a read: it calls `runtime.registry.define(name, …)`
(`core/src/port-queue.ts:130`), which makes `registry.isRegistered(name)` true forever after.

Two visible consequences once anyone opens the Schedules page:

- `QueueInfo.inUse` is computed as `registry.isRegistered(row.name)`
  (`core/src/monitoring/stats.service.ts:94`), so **every queue flips to "In use"** on the
  Overview table and the Usage filter stops discriminating.
- `removeQueue` throws `QueueInUseError` for every queue (`core/src/port-queue.ts:247`), so the
  "Remove queue" button vanishes from Queue detail (`pages/QueueDetail.tsx:73` gates on
  `!info.inUse`) and would 409 if it were reached.

`runAction` has the same problem at `routes.ts:313` — every pause/retry/remove/add marks its
queue in use. The `removeQueue` branch already avoids this deliberately
(`routes.ts:301` — *"Deliberately not createQueue() — that would register it in this process and
trip the guard"*), which shows the hazard was known but only patched at one call site.

Needs a read-only path in core (e.g. `portQueue.getSchedules({ queue })`, or a
`createQueue`-equivalent that doesn't `define`) so the dashboard can act on a queue without
claiming it.

(comment - th dashboard itself and its api should never call createQueue under the hood, the dashboard has access to the dev provide pq instance and that one should be used to get the queues map and work with that)

### 1.3 `title` is interpolated into an inline `<script>` unescaped **[confirmed]**

`assets.ts:122` and `assets.ts:135` emit
`<script>window.__PORTQUEUE_DASHBOARD__=${JSON.stringify(config)};</script>`. `JSON.stringify`
does not escape `<`, so a title of `</script><script>alert(1)</script>` breaks out of the script
element. `inlineShell` escapes the title for the `<title>` element but not for the script.

The value is developer-supplied (`DashboardOptions.title`), not attacker-supplied, so this is a
hardening fix rather than a live XSS — but it is a one-line one: escape `<` to `<` (and
``/``) in the serialized config.
(comment - fix that)

### 1.4 `useQuery` has no request sequencing — a slow response can clobber a newer one

`queries/use-poll.ts:34` fires a fetch per dep change with no abort and no generation counter.
Navigate `job A → job B` while A is in flight and A's response lands last, rendering A's record
under B's URL. Same for a filter change on a laggy jobs table. Add an `AbortController` +
discard-if-stale guard.

Also: `useEffect(() => { void run() }, [...deps, pulse])` spreads a caller-supplied array into a
dependency list. React requires a constant dep-array size between renders; every caller happens
to pass a fixed-length array today, so nothing breaks, but it's a landmine and it defeats the
exhaustive-deps lint.
(comment - install the react query package from tanstak just put in pkg json and then ask me to run npm install, and use the hooks from that lib instead of creating our own, also replace the fetch in favour to axios, have an axios client and use that in the queries)

### 1.5 A read-only *identity* still gets the full mutating UI **[confirmed]**

`auth.ts` lets a custom guard return `{ authorized: true, readOnly: true }` per request, and
`routes.ts:205` correctly merges it into `effectiveReadOnly`. But the client reads `readOnly`
from the static, build-time-injected `window.__PORTQUEUE_DASHBOARD__` (`queries/api.ts:24`),
which only carries the **server-wide** `options.readOnly`.

Result: a read-only user sees every action button and the read-only banner never appears; each
click round-trips to a `403 Dashboard is read-only` toast.

`GET /api/config` (`routes.ts:213`) returns exactly the right per-request value — **and no client
code ever calls it** (confirmed: no reference outside the route itself). Fetch it on boot and
hold it in context, or fold `readOnly` into a `/api/session` payload.

(comment - drop at all the readonly implementation, we do not need that at all, we should have only one mode that we support the default one where if a user has access to the dashboard then he can do all the actions that we have)

### 1.6 `Field htmlFor` points at nothing for the two numeric inputs **[confirmed]**

`AddJobForm.tsx:132` (`add-job-priority`) and `:157` (`add-job-every`) set `htmlFor`, but
`InputNumber` accepts no `id` and does not spread rest props onto the `<input>`
(`ui/src/components/InputNumber.tsx:5-15`). Both labels are orphaned — clicking them focuses
nothing and screen readers announce an unlabelled spinbutton. Add `id`/`...rest` to
`InputNumberProps`.

(comment -fix that)

### 1.7 "Recurring" can silently create a one-off job **[confirmed]**

In `AddJobForm.submit` (`AddJobForm.tsx:85-91`), if the mode is `recurring` but both `cron` and
`everyMs` are empty, no schedule fields are attached — a plain job is added, while the button
reads "Create schedule" and the toast says "Schedule created". Validate that recurring mode has
exactly one of cron / interval before submitting.

(comment - fix that, have validations in all ADD modals that we have, for jobs also have checkbox to check if cron or every should be used and the input should appear conditionally)

### 1.8 Timeline prints a raw enum value **[confirmed]**

`LifecycleTimeline.tsx:59` renders `Now: {job.status}` → `Now: FAILED`. This contradicts the
package's own stated invariant (`constants/labels.ts:1-5`: *"The UI never prints a raw enum
value"*), and the `app.test.tsx:159` assertion that `FAILED` is absent only passes because the
job-detail test doesn't assert on the timeline. Use `statusLabel()` and honour `job.stalled`,
the way `JobDetail.tsx:192` already does.


(comment - fix that, use the labels, and search for similar issues and fix)

### 1.9 Page number isn't clamped when a filter shrinks the result set

`filterAndPage` (`queries/use-table-params.ts:117`) slices at `(page-1)*PAGE_SIZE` with no upper
bound. On page 3 of the queues table, typing a search that narrows to 5 rows leaves an empty
table reading "Results (5)". Clamp `page` to `ceil(total/PAGE_SIZE)`.

(comment - fix that)

### 1.10 `Col span` is dead on the activity cards **[confirmed]**

`KpiCards.tsx:37` passes `span={4} flex="auto"`, and `Col` treats `flex` as an override of
`span` (`ui/src/components/Grid.tsx:52-59`). The `span` is inert. Separately, 5 cards × span 4 =
20 of 24 columns, so the intent wasn't a full row either. Pick one sizing model.

(comment - pick one sizing model, pick the best)

---

## 2. Correctness & robustness

### 2.1 No error state on four of five pages

Only `JobDetail` reads `query.error` (`pages/JobDetail.tsx:153`). Overview, Instances, Schedules
and JobsTable render their *empty* state when the API 500s, 401s or the network drops — "No
queues yet." is indistinguishable from "the dashboard can't reach the server". Add a shared
error/retry state to `TableCard`, and surface the response body in `api.get`'s thrown error
(`queries/api.ts:46` currently discards it, unlike the POST path at `:78`).

(comment - when a error happens in some page, if is a table there instead of saying no items show a error alert, if is for activity/statistics cards show instead of teh cards show the alert... Have meaningful errors messages)

### 2.2 No error boundary

A render throw anywhere blanks the SPA to a white page with a console trace. Wrap the routed
outlet in an error boundary with a reload affordance. Also, `main.tsx:26` silently no-ops when
`#root` is missing.

(comment - fix that have some error boundary)

### 2.3 Job detail never refreshes on its own

`JobDetail` uses `useQuery`, not `usePoll` (`pages/JobDetail.tsx:149`) — by design for terminal
records, but it applies equally to `ACTIVE`/`RETRY` jobs, which then sit frozen. With 1.1
broken, the SSE pulse doesn't rescue it either, and the header's manual refresh button only
renders while live-updates are *paused* (`Shell.tsx:213`). Poll while the job is non-terminal,
or always offer refresh.

(comment - fix that every page should have long pooling)

### 2.4 SSE connections are unbounded and unmetered

`subscribeEvents` (`routes.ts:400`) registers **19 listeners on the shared event bus per
connection**, with no cap on concurrent streams and no backpressure check on
`res.write`'s return value. N browser tabs × 19 registrations fan out on every emit, on the
producer's hot path. Add a max-connections guard, and drop/close a client whose socket buffer
backs up.

(comment - drop usage of sse, we should use only long pooling, fetch on intervals)

### 2.5 Traversal guard is coincidentally safe, not robustly safe

`assets.ts:74-78` strips leading `../` then checks `target.startsWith(root)`. It holds today
because `join()` normalizes, but the prefix check lacks a trailing separator (a sibling
`…/client-evil` would pass the string test) and the leading-`../` regex is redundant with
`normalize`. Use `resolve()` + `relative()` and reject on `..`/absolute, or at minimum compare
against `root + sep`.

(comment - fix that)

### 2.6 `sameOrigin` depends on an unvalidated `Host` header

`routes.ts:81` compares `Origin`/`Referer` host against `Host`. Behind a proxy that rewrites
`Host` (or with `X-Forwarded-Host` in play) this mismatches and blocks legitimate mutations. Let
`DashboardOptions` declare trusted origins, and document the reverse-proxy expectation.

(comment - our dashboard should not have these checks, its is devs responsibility, they can put a middleware in front, in the docs page in dashboard page have a section that explains that it is developer responsibility to protect the dashboard with middlewares in front)

### 2.7 No brute-force protection on Basic auth

`authorize` (`auth.ts:73`) compares in constant time but imposes no delay, lockout or rate limit.
A dashboard exposed on the public internet with `mode: 'basic'` is online-guessable. Worth at
least documenting; better, add a simple per-IP backoff.

(comment - drop at all our basic auth implementation we should not support one, and in our docs have an example that tells the user that our dashboard can be put under a auth middleware, have an example with the npm basic-auth package tell them to use that or their own implementation, update the dashboard docs... for cli still btw have the basic auth implementation but also use the basic-auth package and then ask me to run npm install, but dashboard itself should not have its auth impl)

### 2.8 Missing response hardening headers

Asset and API responses set only `content-type`. No `X-Content-Type-Options: nosniff`, no CSP, no
`Referrer-Policy`. A CSP is easy here because the SPA has exactly one inline script (the config
blob) — a nonce would cover it.

(comment - fix this)

### 2.9 Stale ids survive into bulk actions

Selection is cleared on page/filter/search change (`JobsTable.tsx:72`) but not when a poll
removes rows underneath it. A bulk remove then targets ids that no longer exist; the per-job
failures surface as a burst of toasts (see 3.3). Intersect the selection with the current row set
after each fetch.

(comment - fix that)

### 2.10 `relativeTime` never re-renders

`components/format.ts:10` computes against `Date.now()` at render time, so "2 minutes ago" is
only correct until the next poll (up to 30s stale), and is frozen indefinitely while
live-updates are paused. Same for the `removable` computation in `Instances.tsx:100`. A shared
1s ticker (or `Intl.RelativeTimeFormat` + an interval per visible cell) fixes both.

(comment - have a special component in react that accepts the time and with an setState once in 1sec updates triggers a rerender of himself and the new time will be visible, but improve that component make sure it doesn't block renders of parent components, the set state should not keep teh time, but just the last updated at and when it is refreshed the time in render should auto update, since parent rerenders aslo can trigger rerenders, come up with a smart solution and have comments)

---

## 3. Performance & scale

### 3.1 Three of four tables load the entire dataset every 30s

Only the jobs table is server-paged. Overview (`api.getQueues`), Instances (`api.getInstances`)
and Schedules (`api.getSchedules`) fetch **every** row and page it in the browser via
`filterAndPage`. `GET /api/queues` additionally runs one `countJobsByStatus` query per queue
(`core/src/monitoring/stats.service.ts:88`). At a few hundred queues this is a heavy query
storm every 30s, per open tab. Push `limit`/`offset`/`search`/filters to the API for all four.

(comment - all of them should have pagination support same as the jobs one, also all of them should have counting capabilities)

### 3.2 `GET /api/schedules` is a sequential N+1

`routes.ts:243-248` awaits `getSchedules()` once per queue, in series, on every poll — on top of
the registry pollution in 1.2. Needs a single `listSchedules({ queue?, limit, offset })` read in
core.

(comment - fix this, but name getSchedules improve that method)

### 3.3 Bulk retry/cancel are one request per job

`JobsTable.runBulk` (`JobsTable.tsx:167`) and `SchedulesPanel.removeSelected`
(`SchedulesPanel.tsx:83`) loop `await run(...)` serially. 20 selected rows = 20 sequential
round-trips. Meanwhile `remove` already has a batch path (`jobIds`). Two problems to fix
together:

- add batch `retry`/`cancel`/`removeSchedule` (core has `removeJobs`; the others are per-job),
- report the outcome once. `silent: true` suppresses the success toast but **not** the error
  toast (`queries/use-action.ts:40`), so a bad batch produces N error toasts and no summary.

(comment - have a special endpoint in dashboard no need ot implement something in core, that enpoint still will call the single methods in background, but will give to all of them same TX and if one fails all won't be committed, the tx can be get based on the driver get the driver from pq, make sure the pq has some method to get access to the driver maybe)

### 3.4 No caching or compression for assets

`serveAsset` `stat()`s the bundle on **every** request (`assets.ts:51`, called at `:64`), and
sends no `cache-control`, `ETag` or `Last-Modified`. Vite emits content-hashed filenames, so
`immutable` caching is safe and free. No gzip/br on assets or JSON either — a 200-row jobs page
with real payloads is not small.

(comment - fix this)

### 3.5 Single bundle, no splitting, no source maps

`vite.client.config.ts` has one entry, no `manualChunks` and `sourcemap: false`. Route-level
splitting would trim first paint; a hidden/uploaded source map would make production issues
debuggable.

(comment - is that even possible? it is shipped as a node package that is put under a midleware to be served, if splitting is possible let's do if no then no if it breaks or adds more overhead and dev should provide some extra props then do not implement)

---

## 4. Feature gaps (API supports it, UI doesn't)

### 4.1 `throughputPerMinute` and `failureRate` are shipped and discarded **[confirmed]**

Serialized at `server/api/serialize.ts:77-78`, typed in `StatsDto`, fetched on every stats poll —
and rendered nowhere. `app.test.tsx:118-119` actively asserts their absence. Either surface them
(a throughput sparkline is the single most-requested queue-dashboard widget) or stop computing
and sending them.

(comment - drop at all support for `throughputPerMinute` and `failureRate`, remove from code entirely)

### 4.2 `purge` is implemented server-side with no caller **[confirmed]**

`routes.ts:347` handles `kind: 'purge'` (bulk remove by status) and it's in `ActionRequestDto`,
but nothing in the client sends it. A "Purge completed / failed" control on Queue detail is the
obvious home.

(comment - drop at all suport for this, remove from code)

### 4.3 The add-job form exposes ~half of `AddJobOptions`

`buildAddOptions` (`routes.ts:165`) accepts `singletonKey` and `startAfter`; the form offers
neither. Also absent: `retryMaxAttempts`, `preferredInstanceKeyPattern`. And there's no
client-side cron validation — a bad expression is a server round-trip and a toast.

(comment - improve)

### 4.4 No sorting, no page size control

The jobs API takes `order` (`routes.ts:125`) but `JobsTable.tsx:64` hardcodes `'desc'` with no
column-header affordance. `PAGE_SIZE` is a fixed 20 (`use-table-params.ts:12`) though the API
clamps to 200 (`routes.ts:120`).

(comment - no need for that, hav ecomments that this is not something usefull, and adds unecesary overhead)

### 4.5 Job search is id + status only

`matchesJobSearch` (`routes.ts:131`) covers `id` and `status` over a bounded 500-row window.
Searching by `idempotencyKey`, `failureMessage` or payload contents is the common need. The scan
window is a real engine constraint (no text index) — but the truncation notice
(`JobsTable.tsx:224`) sits *below* the card where it's easy to miss; it belongs in the toolbar
next to the result count.

(comment - implement this)

### 4.6 `scheduleId` filter is unreachable

The jobs API accepts `scheduleId` (`routes.ts:117`) but no UI sets it. Job detail links a job's
schedule to the bare `/schedules` list (`JobDetail.tsx:280`) instead of to that schedule's job
history — and the Schedules table has no "view jobs" action.

(comment - every schedule should have a details page, that link should go tot the schedule details page, even the schedules table their ID should be clicakble and go to details, in details page we should have 2 cards in separate full rows, one with schedule details, and one below with produced rows, and should have same table as the jobs table but only include jobs that that schedule produced)

### 4.7 `DashboardOptions.theme` does nothing **[confirmed]**

It's typed (`server/types.ts:18`), injected into the config blob (`engine.ts:34`), and ignored:
`useThemeMode` (`ui/src/components/ThemeSwitcher.tsx:37`) seeds from `localStorage` then the OS
preference, never from `window.__PORTQUEUE_DASHBOARD__`. Wire it as the default-when-unset, or
remove it from the public surface. **Either way `docs/docs/dashboard.mdx` needs updating** —
per `CLAUDE.md`, docs track the public API.

(comment - fix that, use the useThemeMode)

### 4.8 No schedule pause/resume, no job-payload editing on retry

Core exposes schedule enable/disable state (`ScheduleDto.enabled` is rendered) but the only
schedule action is remove. Retrying with an edited payload is a standard triage move; today
"Clone" is the workaround.

(comment - fix that have action to enable or disable a schedule)

---

## 5. Packaging & tooling

### 5.1 `react-router-dom` is an undeclared dependency **[confirmed]**

The SPA imports it in `App.tsx`, `Shell.tsx`, four pages and `use-table-params.ts`, and it appears
in **no** `package.json` in the repo. It resolves today only because Docusaurus hoists
`react-router-dom@5.3.4` to the root `node_modules`. A standalone install of
`packages/dashboard`, or a Docusaurus upgrade that moves to v6, breaks the client build with no
warning. Add it to `devDependencies` alongside `react`/`styled-components` (it's bundled, so
`dev` is the right bucket) and pin the major.

While there: react-router v5 is in maintenance. Plan a v6/v7 move, or pin deliberately and say
why.

(comment - fix that)

### 5.2 Client code is essentially untested

`jest.config.mjs:40` limits `collectCoverageFrom` to `src/server/**` plus `format.ts` — every
hook, page and component is excluded from coverage by construction. The two client test files are
render smoke tests. Missing entirely:

- read-only mode hides actions (and the banner renders),
- API error → the page shows an error, not an empty table,
- the SSE bridge (would have caught 1.1),
- the search-truncated banner,
- the express / koa / fastify / nest adapters — `create-dashboard.test.ts` only asserts each
  method returns a function.

Per `CLAUDE.md` the sandbox blocks ports, so adapter coverage means in-process `(req, res)`
mocks — `test-support/http-mocks.ts` already provides them.

(comment - remove sse support, remove readonly support, and fix rest as stated in other comments)

### 5.3 `hasBuiltClient()` fallback is invisible in production

If the bundle is missing, every navigation serves the "not built yet" shell (`assets.ts:66`) with
a 200. A misconfigured deploy looks like a working server. Log a warning once at
`createDashboard` time.

(comment - fix, have error)

---

## 6. UX & accessibility

### 6.1 The mobile drawer isn't a real dialog

`Nav` (`Shell.tsx:58`) hides off-canvas with `transform: translateX(-100%)` — it stays in the tab
order and reachable by screen readers while "closed". Opening it doesn't move focus in, focus
isn't trapped, and it carries no `aria-modal`. `Escape` and the scrim click do work
(`Shell.tsx:234`, `:276`). Add `inert`/`visibility: hidden` when closed plus a focus trap.

(comment - fix this)

### 6.2 Timestamps have no absolute value on hover

`relativeTime` cells (jobs table, schedules) show "3 hours ago" with no `title` carrying the exact
timestamp, and `formatDate` uses bare `toLocaleString()` with no timezone marker — ambiguous the
moment anyone shares a screenshot across regions. Add a hover title, and consider a UTC/local
toggle.

(comment - have a special component and have tooltips by default for timestamps, maybe use what I said above a component that can show the date from now in realtime, and use thats ame component for this putpose as well, have a Time component maybe that is configurable for all tehse cases)

### 6.3 Applied filters are invisible until you open the modal

`TableCard` shows a count badge (`TableCard.tsx:116`) but not *which* filters are on. Dismissible
chips in the toolbar, each clearable, are the standard fix. Related: `FiltersModal`'s re-seed
effect depends only on `[open]` (`FiltersModal.tsx:77`), so the draft goes stale if the URL
changes while the dialog is open.

(comment - after teh Results, there should be a row for filters, each applied filter should have a grey tag like this (filterName: value X) each should habve a x icon as well and allow removing teh filter)

### 6.4 `KpiCards` styles `Statistic` through its internal DOM

`ColoredStat` (`KpiCards.tsx:14`) reaches in with `& > div > div:last-child { color: … }`. Any
markup change inside `Statistic` silently drops the status colouring. Add a `valueColor` (or
`tone`) prop to `Statistic` in `@portqueue/ui` instead.


(comment - fix this)

### 6.5 Empty states don't teach

"No queues yet." / "No recurring schedules." are dead ends. A first-run dashboard should link the
getting-started docs and show the snippet that creates a queue.

(comment - when the empty state is shown in that message at the end have a text like, here is how to add your first job/queue etc and link to the docs page)

### 6.6 `refetch` identity changes every render

`use-poll.ts:54` returns a fresh closure each render, so `onChanged={schedules.refetch}`
(`pages/Schedules.tsx:22`) re-renders `SchedulesPanel` on every parent render. Wrap in
`useCallback`. Related: `QueryState.refetching` is computed and returned but **no component reads
it** — either surface a background-refresh indicator or drop the field.

(comment -fix this)

---

## 7. Follow-ups if any of the above land

- `docs/docs/dashboard.mdx` is the only dashboard doc page and is registered in
  `docs/sidebars.ts:32`. Per `CLAUDE.md`, any change to options, DTOs, endpoints or actions must
  be reflected there — 4.7 (`theme`), 4.2 (`purge`) and 1.5 (`readOnly` semantics) all touch
  documented behaviour.
- Every string the UI renders already funnels through `client/constants/labels.ts`, so the SPA is
  one lookup layer away from i18n if that's ever wanted.

(comment - skip this)
