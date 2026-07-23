---
id: rate-limiting
title: Rate limiting & backpressure
sidebar_label: Rate limiting
---

# Rate limiting & backpressure

Every throughput throttle lives under one `limiter` group on the worker. **All of these are
worker-local** — they apply in-process, to that one running instance only. There is no
cluster-wide coordination: two instances each keep their own counters. Omit the whole group
to run with defaults (concurrency 1, unbounded rate).

## The `limiter` options

Everything you can set on `createWorker({ limiter })`, all scoped to that single worker/instance:

| Option | What it does |
|---|---|
| `concurrency` | Max handlers running **in parallel** in this worker (default 1). |
| `rateMax` | Token-bucket cap: max jobs started per window. Requires `rateDuration`. |
| `rateDuration` | The window for `rateMax`, a `Duration` like `'1m'`. Requires `rateMax`. |
| `respectSystemPressure` | Pause claiming while system pressure is high (default **`false`**). |
| `batchSize` | Max jobs claimed per fetch (defaults to `concurrency`). |
| `pollIntervalMs` | Poll cadence when LISTEN/NOTIFY is unavailable. |
| `lockDurationMs` | Visibility timeout / heartbeat window for a claimed job (default 30000). |

None of these are persisted or shared: they tune how hard *this* process pulls from the queue.
To change fleet-wide throughput, add or remove workers/instances.

## Worker-local rate cap

- **Worker rate cap** — `rateMax` + `rateDuration` form a **worker-local**, in-process token
  bucket (exact for that worker): at most `rateMax` jobs started per `rateDuration` window. Both
  are required together. Use it to bound one process's throughput, e.g. to protect a third-party API.

PortQueue has **no cluster-wide job-rate cap** — there is no shared DB counter throttling how
many jobs the fleet may process. If a worker is running, it claims the work that's there;
scale throughput by adding/removing workers and instances, and bound a single process with its
local rate cap. (Cluster-wide *pause* is still available via queue and instance pause.)

```ts
const pq = new PortQueue({
  driver,
  monitor: { maxEventLoopDelayMs: 200, maxCpuPercent: 85, resumeHysteresis: '5s' },
});

pq.createWorker({
  queue: 'third-party',
  limiter: {
    concurrency: 10,
    rateMax: 50,                       // this worker's local cap…
    rateDuration: '1m',                // …per window
    respectSystemPressure: true,       // opt in — default is false
  },
});
```

`rateMax` and `rateDuration` must be set together; `rateDuration` is a `Duration` string like `'1m'`.

## System-pressure backpressure

Enable the `SystemMonitor` on the client (`monitor`) and set thresholds for event-loop
delay, CPU, and memory. When a box is under pressure, workers with
`limiter.respectSystemPressure: true` pause claiming until pressure normalizes (with
hysteresis to avoid flapping). It **defaults to `false`** — a worker consumes as much as it
can unless you opt in. This composes with the rate limits above — pressure gating and rate
limits both throttle claiming, independently.

Observe pressure via events:

```ts
pq.on(PortQueueEvent.SYSTEM_PRESSURE_HIGH, () => {});
pq.on(PortQueueEvent.SYSTEM_PRESSURE_NORMAL, () => {});
```
