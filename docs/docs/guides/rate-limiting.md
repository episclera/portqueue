---
id: rate-limiting
title: Rate limiting & backpressure
sidebar_label: Rate limiting
description: Throttle PortQueue workers with concurrency, token-bucket rate limits, and system-pressure backpressure to protect third-party APIs and busy hosts.
keywords: [portqueue, rate limiting, concurrency, backpressure, workers, job queue, throughput, node.js]
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
  monitor: { maxEventLoopDelayMs: 200, maxCpuPercent: 85, resumeHysteresis: 0.8 },
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

The client samples **this process's own** health and raises a pressure flag when a threshold you set
is breached; workers with `limiter.respectSystemPressure: true` then stop claiming until it clears
(with hysteresis, to avoid flapping). Sampling is **on by default** with
`{ maxEventLoopDelayMs: 200, sampleIntervalMs: 2000 }`; `monitor: false` turns it off entirely.
Pressure gating and the rate limits above throttle claiming independently — they compose.

### Every `monitor` option

| Option | Type | Default | What it does |
|---|---|---|---|
| `sampleIntervalMs` | `number` | `2000` | How often metrics are sampled. Every threshold is checked once per sample, so this is also the worst-case reaction time. |
| `maxEventLoopDelayMs` | `number` | `200` (default config only) | Pressure when the **mean** event-loop delay since the last sample exceeds this, in ms. The best single signal that the process is saturated. |
| `maxCpuPercent` | `number` | unset | Pressure when this process's CPU use since the last sample exceeds this. It's process CPU summed across cores, so a busy multi-core box can read well over 100. |
| `maxMemoryPercent` | `number` | unset | Pressure when RSS exceeds this share of **total machine memory** (`os.totalmem()`) — not of a container limit. |
| `maxRssBytes` | `number` | unset | Pressure when RSS exceeds this absolute byte count. Use it when a cgroup/container cap is the real ceiling, since `maxMemoryPercent` can't see it. |
| `resumeHysteresis` | `number` | `0.8` | Fraction (0–1) of the breached threshold the metric must fall back to before workers resume — `0.8` with `maxCpuPercent: 85` resumes at 68. Lower is more conservative. |

Every threshold is optional and **only the ones you set are checked**. Your `monitor` object
*replaces* the default rather than merging with it, so `monitor: { maxCpuPercent: 85 }` no longer
watches event-loop delay, and `monitor: {}` samples but can never report pressure.

Thresholds are evaluated in a fixed order — `maxEventLoopDelayMs`, `maxCpuPercent`, `maxRssBytes`,
`maxMemoryPercent` — and the **first breach wins**: that's the metric reported on the event.

```ts
const pq = new PortQueue({
  driver,
  monitor: {
    sampleIntervalMs: 2000,
    maxEventLoopDelayMs: 200,
    maxCpuPercent: 85,
    maxMemoryPercent: 90,
    maxRssBytes: 1_500_000_000,
    resumeHysteresis: 0.8,
  },
});

pq.on(PortQueueEvent.SYSTEM_PRESSURE_HIGH, ({ metric, value, threshold }) => {
  // metric: 'eventLoopDelayMs' | 'cpuPercent' | 'rssBytes' | 'memoryPercent'
});
pq.on(PortQueueEvent.SYSTEM_PRESSURE_NORMAL, () => {});
```

A pressure-high transition is also logged at `warn` (with the metric, value and threshold), and the
return to normal at `info`.
