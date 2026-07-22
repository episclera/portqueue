---
id: rate-limiting
title: Rate limiting & backpressure
sidebar_label: Rate limiting
---

# Rate limiting & backpressure

A worker-local rate limit plus system-pressure backpressure.

## Worker-local limiter

- **Worker `limiter`** — a **worker-local**, in-process token bucket (exact for that
  worker). Use it to bound one process's throughput, e.g. to protect a third-party API.

PortQueue has **no cluster-wide job-rate cap** — there is no shared DB counter throttling how
many jobs the fleet may process. If a worker is running, it claims the work that's there;
scale throughput by adding/removing workers and instances, and bound a single process with its
local `limiter`. (Cluster-wide *pause* is still available via queue and instance pause.)

```ts
const pq = new PortQueue({
  driver,
  monitor: { maxEventLoopDelayMs: 200, maxCpuPercent: 85, resumeHysteresis: '5s' },
});

pq.createWorker({
  queue: 'third-party',
  concurrency: 10,
  limiter: { max: 50, duration: '1m' },   // this worker's local cap
  respectSystemPressure: true,
});
```

The limiter uses `{ max, duration }` where `duration` is a `Duration` string like `'1m'`.

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
