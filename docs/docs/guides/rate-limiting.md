---
id: rate-limiting
title: Rate limiting & backpressure
sidebar_label: Rate limiting
---

# Rate limiting & backpressure

Two rate limits with different scopes, plus system-pressure backpressure.

## Cluster-wide vs worker-local

- **Queue `rateLimit`** — a **cluster-wide** cap across every instance (a shared,
  DB-backed usage counter). Use it to protect a third-party API from the whole fleet.
- **Worker `limiter`** — a **worker-local**, in-process token bucket (exact for that
  worker). Use it to bound one process's throughput.

```ts
const pq = new PortQueue({
  driver,
  monitor: { maxEventLoopDelayMs: 200, maxCpuPercent: 85, resumeHysteresis: '5s' },
});

// cluster-wide: at most 100 / minute across all instances
const api = pq.createQueue('third-party', { rateLimit: { max: 100, duration: '1m' } });

pq.createWorker({
  queue: 'third-party',
  concurrency: 10,
  limiter: { max: 50, duration: '1m' },   // this worker's local cap
  respectSystemPressure: true,
});
```

Both use `{ max, duration }` where `duration` is a `Duration` string like `'1m'`.

## System-pressure backpressure

Enable the `SystemMonitor` on the client (`monitor`) and set thresholds for event-loop
delay, CPU, and memory. When a box is under pressure, workers with
`respectSystemPressure: true` (the default) pause claiming until pressure normalizes
(with hysteresis to avoid flapping). This composes with the rate limits above — pressure
gating and rate limits both throttle claiming, independently.

Observe pressure via events:

```ts
pq.on(PortQueueEvent.SYSTEM_PRESSURE_HIGH, () => {});
pq.on(PortQueueEvent.SYSTEM_PRESSURE_NORMAL, () => {});
```
