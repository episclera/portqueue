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
| `rateMax` | Token-bucket cap: max jobs started per window. Requires `rateDurationSeconds`. |
| `rateDurationSeconds` | The window for `rateMax`, in seconds — e.g. `60`. Requires `rateMax`. |
| `batchSize` | Max jobs claimed per fetch (defaults to `concurrency`). |
| `pollIntervalSeconds` | Poll cadence when LISTEN/NOTIFY is unavailable, in seconds. |
| `lockDurationSeconds` | Visibility timeout / heartbeat window for a claimed job, in seconds (default 30). |

None of these are persisted or shared: they tune how hard *this* process pulls from the queue.
To change fleet-wide throughput, add or remove workers/instances.

Whether a worker pauses under system pressure is **not** a `limiter` option — it follows from
`systemLimiter` on the PortQueue (below).

## Worker-local rate cap

- **Worker rate cap** — `rateMax` + `rateDurationSeconds` form a **worker-local**, in-process token
  bucket (exact for that worker): at most `rateMax` jobs started per `rateDurationSeconds` window. Both
  are required together. Use it to bound one process's throughput, e.g. to protect a third-party API.

PortQueue has **no cluster-wide job-rate cap** — there is no shared DB counter throttling how
many jobs the fleet may process. If a worker is running, it claims the work that's there;
scale throughput by adding/removing workers and instances, and bound a single process with its
local rate cap. (Cluster-wide *pause* is still available via queue and instance pause.)

```ts
const pq = new PortQueue({
  driver,
  // Defining this is what makes every worker respect pressure. Omit it and none do.
  systemLimiter: { maxEventLoopDelaySeconds: 0.2, maxCpuPercent: 85 },
});

pq.createWorker({
  queue: 'third-party',
  limiter: {
    concurrency: 10,
    rateMax: 50, // this worker's local cap…
    rateDurationSeconds: 60, // …per 60-second window
  },
});
```

`rateMax` and `rateDurationSeconds` must be set together; the window is a plain number of seconds.

## System-pressure backpressure

`systemLimiter` is both the configuration and the switch. Pass it and **every** worker on the client
stops claiming while any threshold you set is breached, resuming on the first sample where every
watched metric is back at or under its limit. Omit it — the default — and nothing throttles.

There is deliberately no per-worker opt-in. A limiter describes the health of *the process*, and one
worker continuing to claim while its siblings back off would defeat the point; the earlier
`limiter.respectSystemPressure` flag also made it easy to configure thresholds that silently did
nothing.

:::info CPU and memory are this process's, not the machine's
`maxCpuPercent` is this Node process's CPU over the sample window as a share of **all the cores
available to it** (`os.availableParallelism()`), 0–100 — `85` means it is using 85% of the CPU the
host will give it, whether that host has 2 cores or 64. `maxMemoryPercent` is the process's used
heap as a share of the limit **V8 would abort at** (`--max-old-space-size`), not of machine RAM.

Host-wide readings were tried and are the wrong signal. Linux and macOS both count memory that is
merely *allocated* as used, so `os.freemem()` reports 90%+ on a machine doing nothing much and a
memory threshold never clears. And a process in a container has a limit far below the host's — the
host number is not the ceiling it dies at. Two PortQueue processes on one box now report their own
figures, not a shared one.
:::

:::info Monitoring always runs; only limiting is opt-in
Process CPU and heap are measured whether or not you set a `systemLimiter` — the instance
heartbeat records them, which is what the dashboard's per-instance health and the
`portqueue instances` command read. That can't be switched off. **Event-loop delay is the
exception**: measuring it keeps a `perf_hooks` histogram enabled for the life of the process, so it
is only sampled when `maxEventLoopDelaySeconds` gives it a purpose.
:::

Pressure gating and the rate limits above throttle claiming independently — they compose.

### Every `systemLimiter` option

| Option | Type | Default | What it does |
|---|---|---|---|
| `sampleIntervalSeconds` | `number` | `2` | How often metrics are sampled, in seconds. Every threshold is checked once per sample, so this is also the worst-case reaction time. |
| `maxEventLoopDelaySeconds` | `number` | unset | Pressure when the **mean** event-loop delay since the last sample exceeds this many seconds (`0.2` = 200 ms). The best single signal that the process is saturated, and the only metric not measured at all until you set it. |
| `maxCpuPercent` | `number` | unset | Pressure when **this process's** CPU since the last sample exceeds this share (0–100) of the cores available to it. `85` is a reasonable cap on any core count. |
| `maxMemoryPercent` | `number` | unset | Pressure when **this process's** used heap exceeds this share of V8's heap limit (0–100) — the limit `--max-old-space-size` sets, not machine RAM. |

Every threshold is optional and **only the ones you set are checked**; there are no defaults to
merge with, so `systemLimiter: {}` samples but can never report pressure.

:::info `maxCpuPercent` is core-count independent
It is a share of everything the host will give this process (`os.availableParallelism()`), so `85`
means the same on a 2-core container and a 64-core server, and never reads past 100. Earlier
versions reported a share of *one* core, where a cap looked like `600` on 8 cores — divide any such
cap by your core count.

When you want "the process is saturated" rather than "it is busy", use `maxEventLoopDelaySeconds`:
a process can sit at 30% CPU and still be unable to keep up.
:::

Thresholds are evaluated in a fixed order — `maxEventLoopDelaySeconds`, `maxCpuPercent`,
`maxMemoryPercent` — and the **first breach wins**: that's the metric reported on the
event. Recovery needs **every** watched metric back at or under its threshold, not just the one
that breached, and takes effect on the first sample where that holds.

```ts
const pq = new PortQueue({
  driver,
  systemLimiter: {
    sampleIntervalSeconds: 2,        // sampling cadence, in seconds
    maxEventLoopDelaySeconds: 0.2,   // 200 ms of mean event-loop delay
    maxCpuPercent: 85,               // this process at 85% of the cores it can use
    maxMemoryPercent: 85,            // this process's heap, as a share of V8's limit
  },
});

pq.on(PortQueueEvent.SYSTEM_PRESSURE_HIGH, ({ metric, value, threshold }) => {
  // metric: 'eventLoopDelaySeconds' | 'cpuPercent' | 'memoryPercent'
});
pq.on(PortQueueEvent.SYSTEM_PRESSURE_NORMAL, () => {});
```

A pressure-high transition is also logged at `warn` (with the metric, value and threshold), and the
return to normal at `info`.
