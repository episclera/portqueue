# 07 — Concurrency, Scaling, Rate Limiting & Backpressure

How PortQueue behaves correctly and politely when many jobs, many workers, and many server instances run at once — and how it protects the host from overload and shuts down cleanly.

## 07.1 Concurrency & parallelism (within one worker)

- A `Worker` runs up to `concurrency` handler promises in flight at once (v1: on the main event loop; no worker threads — file 20). This is real parallelism for the I/O-bound work queues almost always do: while one handler awaits the network/DB, the others run, so N jobs make progress concurrently on one process.
- The claim loop keeps in-flight ≈ `concurrency`: it claims `min(concurrency - activeCount, batchSize)` jobs whenever there is capacity and a wakeup fires, then dispatches each claimed job to its own handler promise. Claiming is a **batch** (one `claimJobs` round-trip returns many rows), so filling capacity is one query, not one-query-per-job.
- Each in-flight job has an **automatic heartbeat** that calls `extendLock` at ~⅓ of `lockDurationMs`, so a long-running (but alive) handler keeps its visibility lock and isn't reclaimed as stalled. `job.extendLock()` lets a handler push further manually.
- `activeCount` and capacity are per-worker, in-process (this is fine — it's not correctness state shared across instances).

## 07.1b No head-of-line blocking within a queue

A slow, stuck, or failing job **never** holds up the others in its own queue:
- **Claiming skips busy rows.** `claimJobs` uses `SKIP LOCKED` (or the atomic-update fallback, 03.5): a row another handler/instance is running is invisible to the next claim, so the loop always picks up the next *available* job instead of waiting behind an in-flight one.
- **A retrying/failed job removes itself from contention.** On throw-with-attempts-left the job goes to `RETRY` with a future `start_after`, so it isn't claimable until its backoff elapses — it can't sit at the head blocking others. A terminally failed job is `FAILED` and equally out of the claim set.
- **Ordering is a preference, not a gate.** `priority DESC, start_after ASC` picks *which* available job runs next; it never forces the loop to wait for a specific job. (Strict priority starvation is the one caveat — 07.7.)
- **Parallel workflow runs.** Because each workflow step is its own `job` row (file 06), independent runs of the same workflow are independent jobs and run **in parallel** up to `concurrency`; one run pausing (a `repeat` with `delayMs`, or a step awaiting I/O) does not stall other runs.

## 07.2 Horizontal scaling (across instances)

The design is **instance-agnostic**: correctness never depends on being the only process.

- **Claiming** uses `SKIP LOCKED` (or the atomic-update fallback) so N instances claiming the same queue never double-process a job (file 03.5).
- **Scheduling** and **retention** ticks are cluster-coordinated (claim-the-schedule / advisory lock) so recurring production and cleanup happen once per tick, not once per instance (file 06).
- **Pause state** lives in the `queue` table, so pausing on one instance (or via dashboard/CLI) is observed by all.
- **No shared in-process cache** of claimable/dedup/schedule state. Everything authoritative is in the DB.
- **Notifications** are best-effort accelerators; the safety poll guarantees progress even if an instance misses a NOTIFY (file 03.4).

Result: scale out by running more instances of the consuming app — no configuration change, no leader election required for correctness (advisory locks are an optimization, not a dependency).

## 07.2b Queue independence — a job never waits on another queue

**Queues are fully independent processing lanes.** Work in one queue never blocks work in another; nothing about starting a job in queue B depends on the state of queue A. This is a design guarantee, and here is *how* it holds:

- **One claim loop per queue.** A `Worker` is bound to exactly one queue and owns its own claim loop, heartbeat, and wakeup subscription. Two queues consumed on the same instance are two independent workers running concurrently on the event loop; a busy or blocked loop for queue A does not run queue B's loop less often — they are separate promise chains.
- **Claiming is scoped to one `queue_id`.** `claimJobs` filters on `queue_id` via `ix_job_claim (queue_id, status, priority DESC, start_after)`, and `SKIP LOCKED` only ever touches rows for that queue. One queue's claim query neither scans nor row-locks another queue's jobs, so there is **no shared row lock** across queues to wait on.
- **No global gate.** There is no global "next job" cursor, no single dispatcher, and no cross-queue mutex. Pause (07/04.3), rate limits (07.4), and dedup constraints are all **per-queue** (`singletonKey`/`idempotencyKey` are unique *per `(queue_id, key)`*), so pausing or throttling one queue leaves every other queue untouched.
- **Per-queue backpressure.** A slow queue's jobs simply sit `PENDING`; they consume no worker slots in other queues (slots are per-worker, 07.1). A backlog in queue A cannot starve queue B of its own worker's concurrency.

**The one genuinely shared resource is the DB connection pool.** All of an instance's workers draw from one pool, so if a single queue's handlers hold every connection (e.g. long transactions), other queues' claims can *wait for a connection* — the only place cross-queue contention can appear, and it's resource contention, not a design-level dependency. Guidance (documented in files 12/15): size the pool for the sum of worker concurrencies plus headroom for claim/heartbeat traffic, and keep handler transactions short. For hard isolation between critical and bulk workloads, run them as **separate `PortQueue` instances** (separate pools) or separate deployments — the produce-here/consume-there split (file 05) makes this trivial.

## 07.3 Instance identity & attribution

`InstanceIdentityService` resolves once at startup:
- `instanceId` — stable per process/container. Resolution order: explicit `instance.id` option → container id (read `/proc/self/cgroup` / `/proc/1/cpuset` / `HOSTNAME` in containers, or the Docker/K8s-provided env) → machine product uuid (bare metal) → random uuid fallback.
- **Bare-metal product uuid — permission-safe strategy:** reading `/sys/class/dmi/id/product_uuid` usually needs root, so it is *not* the primary source. Prefer, in order: a persisted per-install id file the app can write (e.g. `~/.portqueue/instance-id` or a configured path), then `os.hostname()` + `os.networkInterfaces()` MAC hash (stable, unprivileged), then `machine-id` (`/etc/machine-id` where readable), then the product_uuid if accessible, then a random uuid persisted for the process. Document that without a writable persist path a "bare metal" host may present a new id per restart, and that `instance.id` can be set explicitly to pin it.
- `instanceType: InstanceType` enum — `CONTAINER | BARE_METAL | UNKNOWN`, detected from the same signals (presence of container markers ⇒ `CONTAINER`).
- Stamped onto every job it runs (`run_on_instance_id`, `run_on_instance_type`) for dashboard "jobs per server/container" stats.
- Detection is best-effort and never throws; failures fall back to `UNKNOWN` + random id and log at debug.

## 07.4 Rate limiting

Two distinct, composable limiters (kept separate so the developer isn't confused about scope):

- **Worker limiter** (`WorkerOptions.limiter`) — a token-bucket `{ max, duration }` limiting how many jobs *this worker instance* starts per window. In-process; simple and precise for a single worker.
- **Queue rate limit** (`QueueOptions.rateLimit`) — a cluster-wide cap on how many jobs of a queue start per window across *all* instances. The `max`/`duration` are **in-memory config** on each instance (same code / shared config module — not a queue-table column); enforcement at claim time shares only a **usage counter** in the DB (a small counter row keyed by `queue_id`, or a windowed count of recent starts) so all instances draw from one budget. Document that cluster-wide limiting has DB cost and slight imprecision at window edges; the per-worker limiter is exact but local.

Both are advisory throttles on *starting* work, not hard admission control on *adding* jobs (adding is always allowed unless the queue is paused with `PauseMode.ALL`).

## 07.5 System-pressure monitor (self-protective backpressure)

Beyond per-job rate limits, PortQueue watches the **host process** and stops pulling work when it's under stress (raw-plan requirement).

`SystemMonitorOptions` (client-level; `false` to disable):
- `sampleIntervalMs` — how often to sample.
- `maxEventLoopDelayMs` — pause claiming when event-loop lag (via `perf_hooks.monitorEventLoopDelay`) exceeds this.
- `maxCpuPercent` — pause when process CPU exceeds this.
- `maxMemoryPercent` (or `maxRssBytes`) — pause when memory exceeds this.
- `resumeHysteresis` — require metrics to fall below a lower threshold for a sustained period before resuming (avoid flapping).

Pressure transitions are observed through the **event bus only** (`SYSTEM_PRESSURE_HIGH` / `SYSTEM_PRESSURE_NORMAL`, file 08) — there is no separate `onPressureChange` option callback, to keep observation on one consistent surface (events) rather than a third mechanism.

Behavior: when any threshold is exceeded, the monitor sets a **backpressure flag**; workers with `respectSystemPressure !== false` stop claiming new jobs (in-flight jobs finish). When metrics recover past the hysteresis threshold, claiming resumes. Emits `SYSTEM_PRESSURE_HIGH` / `SYSTEM_PRESSURE_NORMAL` events. All sampling uses Node built-ins — no dependency.

This protects a box from being driven into swap/GC-death by an aggressive queue, and composes with (does not replace) rate limiting.

## 07.6 Graceful shutdown

`pq.shutdown({ graceful: true, timeoutMs })` (default graceful) runs the reverse-ordered shutdown (file 02.4). Specifically for workers:

1. Stop claiming (set a stopping flag; ignore further wakeups).
2. Let in-flight handlers finish, up to `timeoutMs`.
3. When `timeoutMs` elapses, fire each in-flight `job.signal` (`AbortSignal`) so cooperative handlers can bail; then release still-active jobs (clear their lock) so another instance reclaims them promptly instead of waiting for the visibility timeout.
4. Emit `WORKER_STOPPED` / `CLIENT_STOPPED`.

Wire `shutdown()` to `SIGTERM`/`SIGINT` in the docs' deployment guide (but the library does **not** install signal handlers itself — that's the app's choice; document the recommended snippet). Non-graceful `shutdown({ graceful: false })` aborts immediately and relies on visibility-timeout reclaim.

## 07.7 Fairness & starvation

- Ordering `priority DESC, start_after ASC` means low-priority jobs can be delayed by a steady stream of high-priority ones. Document this, and offer guidance (separate queues per priority tier if strict fairness matters). Optionally expose a future `maxPriorityStarvationMs` — noted in roadmap, not v1.
- `batchSize` and `concurrency` interact: claiming in batches reduces DB round-trips but can let one worker grab a burst; keep `batchSize` ≈ `concurrency` by default so claims track real capacity.

## 07.7b Many queues on one instance (poll-storm caution)

A `Worker` is bound to one queue, so a consumer of many queues creates many workers — each with its own claim loop, heartbeat, and (when LISTEN/NOTIFY is unavailable) its own poller. At high queue counts this multiplies DB round-trips. Guidance (documented in file 12/15): share a longer `pollIntervalMs` across low-traffic queues, rely on LISTEN/NOTIFY where available, and consider a future **multi-queue worker** (a single claim loop fetching across a set of queues) — noted in file 20. This is a scaling caveat, not a correctness issue.

## 07.8 Local final-check checklist

- [ ] Concurrency is bounded per worker; heartbeat keeps live long jobs from being reclaimed.
- [ ] `concurrency` handlers run in parallel; a slow/stuck/retrying job causes no head-of-line blocking within its queue (SKIP LOCKED skips busy rows; retries move to a future `start_after`).
- [ ] Queues are independent lanes: per-queue claim loop, `queue_id`-scoped claiming with no shared cross-queue row lock or global gate; a job never waits on another queue. Only the shared connection pool can contend — documented, with per-instance isolation as the escape hatch.
- [ ] N instances never double-process (claim atomicity) and never double-produce recurring jobs.
- [ ] No correctness-critical state is cached in-process across instances.
- [ ] Worker limiter (local, exact) and queue rate limit (cluster, DB-backed) are separate and documented.
- [ ] System monitor pauses claiming under event-loop/CPU/memory pressure with hysteresis; uses only Node built-ins.
- [ ] Graceful shutdown drains, then aborts via `AbortSignal`, then releases locks for fast reclaim.
- [ ] Instance identity/type detected best-effort, never throws, stamped for attribution.
