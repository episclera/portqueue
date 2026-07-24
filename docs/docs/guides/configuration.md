---
id: configuration
title: Configuration reference
sidebar_label: Configuration reference
---

# Configuration reference

Every knob PortQueue exposes lives on one of three option objects: what you pass to the
**constructor**, to **`createQueue`**, and to **`createWorker`**. This page lists each option,
its type, its default, and what it does. Durations accept a number of milliseconds or a human
string like `'30s'`, `'5m'`, `'1h'`, `'2d'`, `'500ms'`.

## Constructor options

```ts
const pq = new PortQueue<QueueName>({
  driver: postgres({ connectionString: process.env.DATABASE_URL }),
});
```

`PortQueueOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `driver` | `Driver` | — **required** | A driver instance (from a subpath import, e.g. `@portqueue/core/postgres`, or a custom one). Chooses the engine and owns its SQL dialect and migrations. |
| `logger` | `Logger \| LoggerOptions` | built-in console logger | A logger instance you supply, or options for the built-in one (see below). |
| `migration` | `MigrationMode` | `AUTO` | How migrations are applied on `init()`: `AUTO` (apply pending), `MANUAL` (never — call `pq.migrate()` yourself), or `VALIDATE_ONLY` (fail if anything is pending). |
| `storage` | `StorageOptions` | — | DB storage layout: schema, table prefix, and pub/sub namespace (see below). |
| `instance` | `InstanceOptions` | — | This process's identity and heartbeat settings (see below). |
| `monitor` | `SystemMonitorOptions \| false` | — | System-pressure backpressure thresholds; pass `false` to disable sampling entirely (see below). |
| `tickIntervalMs` | `number` | `5000` | Interval for scheduler / retention / monitor background ticks, in milliseconds. |

### `logger` (`LoggerOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LogLevel` | `INFO` | Minimum level to emit: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. |
| `pretty` | `boolean` | pretty when stdout is a TTY | Human-readable output vs. JSON lines. |

### `storage` (`StorageOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `schema` | `string` | — | DB schema / namespace (Postgres / Oracle). |
| `tablePrefix` | `string` | `'pq_'` | Prefix for every table PortQueue creates. |
| `namespace` | `string` | — | Logical prefix for pub/sub channels when several PortQueues share one database. |

### `instance` (`InstanceOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `key` | `string` | anonymous | Stable, human-meaningful name for this process (e.g. `'worker-eu-1'`). Naming a process lets you target and list it; leave it unset to stay anonymous — the process still runs jobs. |
| `id` | `string` | random per-process token | Lock-owner attribution id. Never auto-detected from the environment. |
| `heartbeatIntervalMs` | `number` | `15000` | How often the instance row's `last_seen_at` is refreshed, in milliseconds. |

### `monitor` (`SystemMonitorOptions`)

Workers only pause on system pressure when they opt in via `limiter.respectSystemPressure`.
These thresholds define what counts as "under pressure". Pass `monitor: false` to turn sampling off.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sampleIntervalMs` | `number` | — | How often to sample system metrics, in milliseconds. |
| `maxEventLoopDelayMs` | `number` | — | Event-loop delay above this counts as pressure. |
| `maxCpuPercent` | `number` | — | CPU usage above this counts as pressure. |
| `maxMemoryPercent` | `number` | — | Memory usage above this counts as pressure. |
| `maxRssBytes` | `number` | — | Resident set size above this counts as pressure. |
| `resumeHysteresis` | `number` | — | Fraction (0–1) below the threshold that metrics must fall to before claiming resumes — avoids flapping. |

## Queue options

```ts
const emails = pq.createQueue<{ to: string; template: string }>(QueueName.Emails, {
  defaultJobOptions: { retry: { maxAttempts: 3, backoff: { strategy: BackoffStrategy.EXPONENTIAL } } },
});
```

`QueueOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultJobOptions` | `JobOptions` | — | Defaults every job on this queue inherits; a per-job option always overrides (see below). |
| `retention` | `RetentionOptions` | keep forever | Queue default retention; resolved per-job and frozen onto each row (see below). |
| `hooks` | `HookRegistration[]` | `[]` | Queue-scoped participation hooks. |

### `defaultJobOptions` (`JobOptions`)

These are also the options you can pass per-call to `addJob`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `priority` | `number` | `0` | Higher runs first. |
| `retry` | `RetryOptions` | run once | How the job retries on failure (see below). |
| `expireIn` | `Duration` | — | Expire the job if it hasn't started within this window. |
| `retention` | `RetentionOptions` | inherit queue | Per-job retention override (see below). |
| `idempotencyKey` | `string` | — | Dedupe key — a second enqueue with the same key returns the existing job. |
| `singletonKey` | `string` | — | At most one active job per key at a time. |
| `metadata` | `JobMetadata` | — | Opaque developer metadata for correlation / tracing. |
| `tx` | `TransactionHandle` | — | Transactional enqueue: your own transaction, wrapped by an adapter. |

#### `retry` (`RetryOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `1` | Total attempts including the first (`1` means no retry). |
| `delay` | `Duration` | — | Delay before a retry. |
| `backoff` | `BackoffOptions` | — | Backoff applied to `delay` (see below). |

#### `backoff` (`BackoffOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strategy` | `BackoffStrategy` | — **required** | `FIXED` or `EXPONENTIAL`. |
| `factor` | `number` | `2` | Growth factor for `EXPONENTIAL`; ignored for `FIXED`. |
| `maxDelay` | `Duration` | — | Cap on the computed delay. |
| `jitter` | `boolean` | `false` | Spread retries across instances by randomizing the delay. |

### `retention` (`RetentionOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `RetentionMode` | — **required** | `KEEP_FOREVER` or `DELETE_AFTER`. |
| `ttl` | `Duration` | — | How long after finishing before deletion is allowed (required for `DELETE_AFTER`). |
| `statuses` | `JobStatus[]` | `[COMPLETED]` | Which finished statuses the policy applies to. |

## Worker options

```ts
pq.createWorker({
  queue: QueueName.Emails,
  handler: async (job) => { /* ... */ },
  limiter: { concurrency: 10 },
});
```

`WorkerOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `queue` | `TQueues` (string) | — **required** | The queue this worker claims from. |
| `handler` | `JobHandler \| WorkflowStep[]` | — **required** | A single processor function (simple mode) or an ordered array of steps (workflow mode). Array order is the canonical step sequence. |
| `limiter` | `LimiterOptions` | sensible defaults | Throughput and claim tuning in one group (see below). |
| `dontAutoretryFor` | `Array<ErrorClass \| string>` | `[]` | Celery-style non-retryable errors, matched by `instanceof` or `error.name`. |

### `limiter` (`LimiterOptions`)

All of these are **worker-local** — they apply in-process to that one running instance; there is
no cluster-wide coordination.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | `number` | `1` | Max handlers running at once in this worker. |
| `rateMax` | `number` | — | Max jobs started per `rateDuration` window. Set with `rateDuration` to enable rate limiting. |
| `rateDuration` | `Duration` | — | The window for `rateMax`, e.g. `'1m'`. Set with `rateMax`. |
| `respectSystemPressure` | `boolean` | `false` | Pause claiming while system pressure (CPU / memory / event-loop) is high. Opt in to trade throughput for stability. |
| `batchSize` | `number` | `concurrency` | Max jobs claimed per fetch. |
| `pollIntervalMs` | `number` | `5000` | Poll cadence when `LISTEN`/`NOTIFY` is unavailable, in milliseconds. |
| `lockDurationMs` | `number` | `30000` | Visibility timeout / heartbeat window for a claimed job, in milliseconds. |
