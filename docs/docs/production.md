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
  process.on(sig, async () => { await pq.shutdown({ graceful: true, timeoutMs: 30_000 }); process.exit(0); });
}
```

## Connection pool sizing

Size for the **sum of worker concurrencies** + headroom for claim/heartbeat/notify
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

Enable the `SystemMonitor` and set a worker-local
[rate limiter](./guides/rate-limiting.md) for third-party APIs.

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
- **Tune `instance.heartbeatIntervalMs`** (default 15s) to your failover appetite: an instance is
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
- [ ] Pool sized for the sum of worker concurrencies + headroom.
- [ ] Handlers idempotent; `idempotencyKey`/`singletonKey` where relevant.
- [ ] Retries with jitter + cap; `dontAutoretryFor` for non-retryable errors.
- [ ] Retention on; failed kept longer than completed.
- [ ] `SystemMonitor` on; worker-local rate limiter set for third-party APIs.
- [ ] Stable `instance.instanceKey` on every process (even a single one); jobs that need locality targeted by capability pattern; heartbeat interval tuned.
- [ ] `PortQueueEvent.ERROR` subscribed; metrics/tracing via hooks.
- [ ] Dashboard/CLI behind auth; payloads kept small (no built-in size cap).
- [ ] Readiness gated on `pq.isRunning` + driver ping.
