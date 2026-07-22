---
id: scalability
title: Scalability
sidebar_label: Scalability
---

# Scalability

PortQueue is **instance-agnostic**: it assumes N copies of your app run at once, and it
never relies on in-process state for the correctness of claiming, scheduling, or dedup.
Scaling out is "run more instances" — no leader election.

## How jobs run in parallel

Within one worker, `concurrency` sets how many handlers run at once. Because each job is
an independently claimed row, there is **no head-of-line blocking** inside a queue — a
slow job never stalls its neighbors.

```ts
pq.createWorker({ queue: 'emails', concurrency: 50 });
```

## How queues stay independent

Each queue has its **own claim loop** with `queue_name`-scoped claiming, so a job **never
waits on another queue**. Busy `orders` traffic can't starve `emails`.

## How instances cooperate

- **`SKIP LOCKED`** (where available) lets many instances claim different rows
  simultaneously without lock contention or double-processing. Engines without it use a
  safe locking/polling fallback.
- **Visibility timeout** — a claim is invisible to others for `lockDurationMs`, refreshed
  by an automatic heartbeat. If an instance dies, the lock lapses and the job becomes
  `STALLED` and reclaimable.
- **Cluster-coordinated scheduling & retention** — schedule ticks and retention are
  coordinated so exactly one instance produces a given scheduled run.

## Hard isolation between workloads

For strict isolation, run critical vs bulk workloads as **separate `PortQueue`
instances / pools**, so one can't exhaust the other's connections. Mind the
**connection-pool caveat**: many instances sharing one database still share its
connection budget — size pools for the sum of worker concurrencies plus headroom.

See [Production Best Practices](./production.md) for the operational defaults, and
[Rate limiting & backpressure](./guides/rate-limiting.md) for throttling.
