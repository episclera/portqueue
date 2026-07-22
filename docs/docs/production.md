---
id: production
title: Production best practices
sidebar_label: Production
---

# Production best practices

The one page to read before shipping. It doesn't re-teach features — it collects the
right defaults and habits and links to the deep pages.

## Deployment topology

Split **producers** (API tier — no `createWorker`) from **consumers** (worker tier). Run
critical vs bulk workloads as **separate `PortQueue` instances / pools** for hard
isolation. Wire the **same config module** across every tier so they agree on queues.

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

Assume [at-least-once](./core-concepts/at-least-once.md): make handlers idempotent, use
`idempotencyKey` / `singletonKey`, and design workflow steps as idempotent units.

## Retries & backoff

Set sane `retryMaxAttempts`, exponential backoff **with jitter** and a cap, and
`dontAutoretryFor` for non-retryable errors. Failed jobs stay in `job` (status `FAILED`)
for triage and manual `retryJob` — there is **no dead-letter queue**.

## Retention

Default is keep-forever. Turn on `DELETE_AFTER` [retention](./guides/retention.md) (or
your own pruning); keep failed jobs longer than completed.

## Backpressure & rate limits

Enable the `SystemMonitor` and set a worker-local
[rate limiter](./guides/rate-limiting.md) for third-party APIs.

## Multi-instance & execution locality

For most deployments, leave `instanceKey` unset — interchangeable workers are simplest and most
resilient. Turn on [multi-instance mode](./guides/multi-instance.md) only when work needs
locality (warm cache, local data, region, specialized hardware):

- Give each process a **stable `instanceKey`** (e.g. from your orchestrator's pod/host id). Reuse
  the same key across restarts of the *same* logical instance so affinity and liveness stay
  meaningful.
- Pin with `preferredInstanceKey`/`preferredInstanceKeyPattern`, and **always set a fallback**
  (`fallbackInstanceKey`/`...Pattern`) for jobs that must not stall if a node dies — a dead
  preferred instance hands off to the fallback, then to the cluster.
- Tune `instanceHeartbeatIntervalMs` (default 15s) to your failover appetite: an instance is
  "dead" after ~3 missed beats, which is how long a pinned job waits before a fallback rescues it.
- Use the dashboard **Instances** page (or `pauseInstance`/`resumeInstance`) to drain one node for
  a deploy without touching the rest.

:::caution Dedup is tool-managed
The schema is deliberately **index-free and constraint-free** for sharded/distributed databases.
Idempotency/singleton dedup and queue-name uniqueness are enforced in the tool with a pre-insert
lookup, not a database `UNIQUE` index. This is best-effort under a tight cross-instance race:
two instances inserting the *same* `idempotencyKey` in the same instant can both win. Where exact
once-only insertion is critical, also guard with your own transaction/business key.
:::

## Observability

Structured logging with correlation via `metadata`; **subscribe to
`PortQueueEvent.ERROR`** so nothing is silent; export metrics/tracing through
[hooks](./events-hooks/hooks.md).

## Security

Protect the [dashboard](./dashboard.mdx)/CLI with auth, set `maxPayloadBytes`, and rely on
parameterized queries (never string-built SQL).

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
- [ ] Multi-instance (if used): stable `instanceKey` per process; fallbacks set on pinned jobs; heartbeat interval tuned.
- [ ] `PortQueueEvent.ERROR` subscribed; metrics/tracing via hooks.
- [ ] Dashboard/CLI behind auth; `maxPayloadBytes` set.
- [ ] Readiness gated on `pq.isRunning` + driver ping.
