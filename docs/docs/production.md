---
id: production
title: Going to Production
sidebar_label: Going to Production
description: Ship PortQueue to production — graceful shutdown, pool sizing, idempotency, retries, retention, and a full production checklist.
keywords: [portqueue, production, job queue, scaling, multi-instance, node.js, monitoring, database queue]
---

# Going to Production

The one page to read before shipping. It doesn't re-teach features — it collects the
right defaults and habits and links to the deep pages.

## Graceful shutdown

Install `SIGTERM`/`SIGINT` handlers that drain in-flight jobs; honor `job.signal` in long
handlers; set the timeout to your platform's grace period.

```ts
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => { await pq.shutdown({ graceful: true, timeoutSeconds: 30 }); process.exit(0); });
}
```

## Connection pool sizing

Size for the **sum of every consumed queue's `limiter.concurrency`** + headroom for claim/heartbeat/notify
traffic. Keep handler transactions short so one queue can't starve the shared pool.

## Reliability & idempotency

Assume [at-least-once](./guides/consuming-jobs.md#at-least-once--idempotency): make handlers idempotent, use
`idempotencyKey` / `singletonKey`, and design idempotent handlers.

## Retries & backoff

Set a sane `retry.maxAttempts`, exponential backoff **with jitter** and a cap, and
`dontAutoretryFor` for non-retryable errors. Failed jobs stay in `job` (status `FAILED`)
for triage and manual `retryJob` — there is **no dead-letter queue**.

## Retention

Default is keep-forever. Turn on `DELETE_AFTER` [retention](./guides/retention.md) (or
your own pruning); keep failed jobs longer than completed.

## Backpressure & rate limits

Set a [`systemLimiter`](./guides/rate-limiting.md#system-pressure-backpressure) and a per-queue
[rate limiter](./guides/rate-limiting.md) for third-party APIs.

Its thresholds read **this Node process**, not the machine: `maxCpuPercent` is a share (0–100) of
all the cores available to the process, and `maxMemoryPercent` is used heap over the limit V8 would
abort at.

:::info `maxCpuPercent` is a share of the whole CPU budget
The reading is this process's CPU divided by the core-time available to it
(`os.availableParallelism()`), so `85` means the same on a 2-core container and a 64-core server —
no `cores × 100` arithmetic, and it never reads past 100.

If you only want the single-threaded saturation signal, `maxEventLoopDelaySeconds` is the better
metric: a process can sit at 30% CPU and still be too far behind to keep up.
:::

### Give Node the memory the box has

V8's heap limit is **not** the machine's RAM. Node picks a default from available memory and caps
it in the low gigabytes, so a 64 GB server can run a process that dies at ~4 GB while `free` shows
tens of gigabytes idle — and `memoryPercent` will read 90% right before it does.

**If this process is the only significant thing on the machine, raise the limit explicitly** so the
heap can actually use the hardware you paid for:

```bash
# Leave headroom for the OS, other processes, and Node's off-heap memory (buffers, native addons):
# a rule of thumb is ~75% of the RAM the process may have.
node --max-old-space-size=6144 dist/worker.js   # 6 GB heap
# or, when you don't control the argv:
NODE_OPTIONS="--max-old-space-size=6144" node dist/worker.js
```

In a container, size it against the **container's** limit, not the host's — Node does not read the
cgroup limit when choosing its default, so an unset heap limit on a small container is the usual
cause of an OOM kill with no Node-side error. Setting it also makes `memoryPercent` meaningful:
the percentage is only useful once its denominator is a number you chose.

## Execution locality

**Name every process.** Set a stable
[`instance.instanceKey`](./scale-horizontally.md#choosing-a-preferred-server-with-regex-patterns) from
day one, even when you run a single machine: it costs nothing, and the day you add a second server
nothing about your code has to change. Leaving it unset keeps a process anonymous — it still runs
jobs, but it can't be listed, paused or drained individually, and **no job can ever be steered to
it**, since `preferredInstanceKeyPattern` is rejected on a process without a key. That's the real
reason keys are worth setting up front: without one you have no way to say *"run this job where the
warm cache / local data / GPU / region is"*.

- **Make the key stable and descriptive** (e.g. your orchestrator's pod/host id plus the
  capabilities you target — `…:ram-8gb:cpu-4cor`). Reuse the same key across restarts of the *same*
  logical instance so affinity and liveness stay meaningful.
- **Target work with a capability pattern** (`preferredInstanceKeyPattern`, e.g. `ram-8gb`) rather
  than pinning a host. A pattern spans many servers, so a job is never stranded when one dies — any
  matching instance takes it, and replacing hardware needs no code change. If nothing matches, the
  job waits.
- **Keep most jobs unpinned.** A key makes targeting *possible*; it doesn't make it mandatory. Jobs
  with no pattern run anywhere, which stays the right default for stateless work.
- **Tune `instance.heartbeatIntervalSeconds`** (default `15`) to your failover appetite: an instance is
  "dead" after ~3 missed beats.
- **Drain one node at a time** from the dashboard **Instances** page (or
  `pauseInstance`/`resumeInstance`) for a deploy without touching the rest; remove a decommissioned
  instance once it's been unseen for 30 minutes (`removeInstance` / dashboard /
  `portqueue remove-instance`).

## Observability

Structured logging correlated by `job.id` / queue name; **subscribe to
`PortQueueEvent.ERROR`** so nothing is silent; export metrics/tracing through
[hooks](./events-hooks/hooks.md).

## Security

Protect the [dashboard](./dashboard.mdx)/CLI with auth, and rely on
parameterized queries (never string-built SQL). PortQueue does not cap payload size — the client
accepts any `data`, so keep payloads small yourself (store large blobs elsewhere and pass a reference).

## Health checks & readiness

Expose readiness via `pq.isRunning` + a lightweight driver ping; don't accept traffic
until `init()` resolved.

## Production checklist

- [ ] Producers and consumers split; critical vs bulk on separate instances/pools.
- [ ] `SIGTERM`/`SIGINT` → `pq.shutdown({ graceful: true })`; long handlers honor `job.signal`.
- [ ] Pool sized for the sum of every consumed queue's `limiter.concurrency` + headroom.
- [ ] Handlers idempotent; `idempotencyKey`/`singletonKey` where relevant.
- [ ] Retries with jitter + cap; `dontAutoretryFor` for non-retryable errors.
- [ ] Retention on; failed kept longer than completed.
- [ ] `systemLimiter` set (thresholds read this process, not the host); per-queue rate limiter set for third-party APIs.
- [ ] `--max-old-space-size` set to fit the machine or container, not left at Node's default.
- [ ] Stable `instance.instanceKey` on every process (even a single one); jobs that need locality targeted by capability pattern; heartbeat interval tuned.
- [ ] `PortQueueEvent.ERROR` subscribed; metrics/tracing via hooks.
- [ ] Dashboard/CLI behind auth; payloads kept small (no built-in size cap).
- [ ] Readiness gated on `pq.isRunning` + driver ping.
