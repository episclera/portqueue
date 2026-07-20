# 07 — Concurrency, Scaling, Rate Limiting & Backpressure

How PortQueue behaves correctly and politely when many jobs, many workers, and many server instances run at once — and how it protects the host from overload and shuts down cleanly.

## 07.1 Concurrency (within one worker)

- A `Worker` runs up to `concurrency` handler promises in flight at once (v1: on the main event loop; no worker threads — file 20).
- The claim loop keeps in-flight ≈ `concurrency`: it claims `min(concurrency - activeCount, batchSize)` jobs whenever there is capacity and a wakeup fires.
- Each in-flight job has an **automatic heartbeat** that calls `extendLock` at ~⅓ of `lockDurationMs`, so a long-running (but alive) handler keeps its visibility lock and isn't reclaimed as stalled. `job.extendLock()` lets a handler push further manually.
- `activeCount` and capacity are per-worker, in-process (this is fine — it's not correctness state shared across instances).

## 07.2 Horizontal scaling (across instances)

The design is **instance-agnostic**: correctness never depends on being the only process.

- **Claiming** uses `SKIP LOCKED` (or the atomic-update fallback) so N instances claiming the same queue never double-process a job (file 03.5).
- **Scheduling** and **retention** ticks are cluster-coordinated (claim-the-schedule / advisory lock) so recurring production and cleanup happen once per tick, not once per instance (file 06).
- **Pause state** lives in the `queue` table, so pausing on one instance (or via dashboard/CLI) is observed by all.
- **No shared in-process cache** of claimable/dedup/schedule state. Everything authoritative is in the DB.
- **Notifications** are best-effort accelerators; the safety poll guarantees progress even if an instance misses a NOTIFY (file 03.4).

Result: scale out by running more instances of the consuming app — no configuration change, no leader election required for correctness (advisory locks are an optimization, not a dependency).

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
- **Queue rate limit** (`QueueOptions.rateLimit`) — a cluster-wide cap on how many jobs of a queue start per window across *all* instances. Enforced at claim time using a DB-backed token/counter (a small counter row or a windowed count query) so all instances share the budget. Document that cluster-wide limiting has DB cost and slight imprecision at window edges; the per-worker limiter is exact but local.

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

`pq.stop({ graceful: true, timeoutMs })` (default graceful) runs the reverse-ordered shutdown (file 02.4). Specifically for workers:

1. Stop claiming (set a stopping flag; ignore further wakeups).
2. Let in-flight handlers finish, up to `timeoutMs`.
3. When `timeoutMs` elapses, fire each in-flight `job.signal` (`AbortSignal`) so cooperative handlers can bail; then release still-active jobs (clear their lock) so another instance reclaims them promptly instead of waiting for the visibility timeout.
4. Emit `WORKER_STOPPED` / `CLIENT_STOPPED`.

Wire `stop()` to `SIGTERM`/`SIGINT` in the docs' deployment guide (but the library does **not** install signal handlers itself — that's the app's choice; document the recommended snippet). Non-graceful `stop({ graceful: false })` aborts immediately and relies on visibility-timeout reclaim.

## 07.7 Fairness & starvation

- Ordering `priority DESC, available_at ASC` means low-priority jobs can be delayed by a steady stream of high-priority ones. Document this, and offer guidance (separate queues per priority tier if strict fairness matters). Optionally expose a future `maxPriorityStarvationMs` — noted in roadmap, not v1.
- `batchSize` and `concurrency` interact: claiming in batches reduces DB round-trips but can let one worker grab a burst; keep `batchSize` ≈ `concurrency` by default so claims track real capacity.

## 07.7b Many queues on one instance (poll-storm caution)

A `Worker` is bound to one queue, so a consumer of many queues creates many workers — each with its own claim loop, heartbeat, and (when LISTEN/NOTIFY is unavailable) its own poller. At high queue counts this multiplies DB round-trips. Guidance (documented in file 12/15): share a longer `pollIntervalMs` across low-traffic queues, rely on LISTEN/NOTIFY where available, and consider a future **multi-queue worker** (a single claim loop fetching across a set of queues) — noted in file 20. This is a scaling caveat, not a correctness issue.

## 07.8 Local final-check checklist

- [ ] Concurrency is bounded per worker; heartbeat keeps live long jobs from being reclaimed.
- [ ] N instances never double-process (claim atomicity) and never double-produce recurring jobs.
- [ ] No correctness-critical state is cached in-process across instances.
- [ ] Worker limiter (local, exact) and queue rate limit (cluster, DB-backed) are separate and documented.
- [ ] System monitor pauses claiming under event-loop/CPU/memory pressure with hysteresis; uses only Node built-ins.
- [ ] Graceful shutdown drains, then aborts via `AbortSignal`, then releases locks for fast reclaim.
- [ ] Instance identity/type detected best-effort, never throws, stamped for attribution.
