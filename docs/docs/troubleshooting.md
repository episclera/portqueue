---
id: troubleshooting
title: Troubleshooting
sidebar_label: Troubleshooting
description: Troubleshoot PortQueue with typed error codes and events — diagnose stalled jobs, silent failures, retries, and schema mismatches in your job queue.
keywords: [portqueue, troubleshooting, error codes, events, job queue, node.js, debugging, monitoring]
---

# Troubleshooting

Two channels tell you what went wrong, and you'll usually want both:

- **Typed errors** — thrown synchronously at the call site (`init`, `addJob`, …). Catch
  `PortQueueError` and branch on `error.code`.
- **[Events](./events-hooks/events.md)** — emitted asynchronously as jobs move through the
  system on every instance. This is how you see failures, retries, stalls, and — crucially —
  the **swallowed internal errors** that never reach a `try/catch`.

## Catch typed errors

Catch `PortQueueError` (the base) and branch on `error.code` (`PortQueueErrorCode`) — never
on message strings.

```ts
import { PortQueueError, PortQueueErrorCode } from '@portqueue/core';

try {
  pq.createQueue({ name: 'emails' });
  await pq.addJob({ queue: 'emails', data });
} catch (err) {
  if (err instanceof PortQueueError && err.code === PortQueueErrorCode.QUEUE_PAUSED) {
    // handle the specific case
  }
}
```

### Error codes

| Code | Error class | What it means & the fix |
|---|---|---|
| `NOT_STARTED` | `NotStartedError` | You called a method before `await pq.init()`. The message names the method. Await `init()` first. |
| `INVALID_OPTIONS` | `InvalidOptionsError` | An options object failed validation (e.g. both `schedule.cron` and `schedule.startEverySeconds`, a one-off delay combined with a recurring mode, or a duration that isn't a non-negative number of seconds). Read the message; it names the offending field. |
| `UNSUPPORTED_CAPABILITY` | `UnsupportedCapabilityError` | The driver's engine can't do what you asked. Use a driver that supports it or the documented fallback. |
| `SCHEMA_VERSION_MISMATCH` | `SchemaVersionMismatchError` | The DB schema version differs from the library's. Run `portqueue migrate` (see [Going to Production](./production.md)). |
| `MIGRATION_FAILED` | `MigrationFailedError` | A migration step errored. Check DB permissions and the underlying error; re-run migrate. |
| `DRIVER_CONNECTION_ERROR` | `DriverConnectionError` | Couldn't connect. Check connection string, network, credentials, and that the DB client peer dep is installed. |
| `DRIVER_QUERY_ERROR` | `DriverQueryError` | A query failed at the engine. Inspect the wrapped cause; often a permissions or schema issue. |
| `QUEUE_NOT_FOUND` | `QueueNotFoundError` | An **admin** client (the dashboard or CLI) was asked to produce onto a queue with no row. Declare it in your application with `pq.createQueue({ name })` first — an admin tool never creates queues. Also raised by `pauseQueue`/`resumeQueue` for a name nothing has ever used. |
| `QUEUE_PAUSED` | `QueuePausedError` | An add was refused because the queue is paused with `PauseMode.ALL`. Resume it, or expect this during a drain. |
| `SHUTDOWN_TIMEOUT` | `ShutdownTimeoutError` | `shutdown()` gave up on in-flight work after `timeoutSeconds`. The client is stopped and the driver disconnected either way; raise the timeout or make long handlers honour `job.signal`. |
| `MISSING_PEER_DEPENDENCY` | `MissingPeerDependencyError` | The driver's client (e.g. `pg`, `better-sqlite3`) isn't installed. Install the peer shown in the message. |

:::tip Every code has a class
Each code above is carried by the class beside it, and every one of them is `instanceof
PortQueueError`. There are no codes without a class: a code nothing can throw would be a promise the
library doesn't keep, so the never-thrown placeholders that used to sit here (`ALREADY_STARTED`,
`ALREADY_STOPPED`, `IDEMPOTENCY_CONFLICT`, `SINGLETON_CONFLICT`, `MIGRATION_CHECKSUM_MISMATCH`) are
gone. `init()` is idempotent, dedup returns `result.deduplicated` rather than raising, and a migration
is identified by its version alone.

There is no `JOB_NOT_FOUND` for the same reason: every by-id operation already says "not found" in its
return type — `getJob` gives `null`, `removeJob`/`cancelJob` give `false`, `retryJob` gives `null` —
which is also what lets a bulk action skip a stale id instead of failing the whole batch.
:::

### Exported error classes

Every class below is importable from `@portqueue/core` and extends `PortQueueError`. Each
instance carries `.code` (a `PortQueueErrorCode` string enum value) and `.context` (an object
with the offending fields). Branching on `err.code` is still the most robust check.

| Class | `.code` | Meaning | Typical fix |
|---|---|---|---|
| `PortQueueError` | *(any)* | Base class for every error the library throws. | Branch on `err.code`. |
| `NotStartedError` | `NOT_STARTED` | A method was called before `await pq.init()`. | Await `init()` first. |
| `QueueNotFoundError` | `QUEUE_NOT_FOUND` | A headless (dashboard/CLI) client named a queue with no row, or a pause targeted a name nothing has used. | Declare the queue in your application first. |
| `InvalidOptionsError` | `INVALID_OPTIONS` | An options object failed validation. | Read the message; it names the offending field. |
| `UnsupportedCapabilityError` | `UNSUPPORTED_CAPABILITY` | The driver's engine can't do what was asked. | Use a capable driver or the documented fallback. |
| `SchemaVersionMismatchError` | `SCHEMA_VERSION_MISMATCH` | DB schema version differs from the library's. | Run `portqueue migrate`. |
| `MigrationFailedError` | `MIGRATION_FAILED` | A migration step errored. | Check DB permissions and the cause; re-run migrate. |
| `DriverConnectionError` | `DRIVER_CONNECTION_ERROR` | Couldn't connect to the DB. | Check connection string, network, credentials, peer dep. |
| `DriverQueryError` | `DRIVER_QUERY_ERROR` | A query failed at the engine. | Inspect the wrapped cause (permissions/schema). |
| `QueuePausedError` | `QUEUE_PAUSED` | `add` refused because the queue is paused with `PauseMode.ALL`. | Resume the queue, or expect this during a drain. |
| `QueueInUseError` | `QUEUE_IN_USE` | `removeQueue` refused because the queue still has jobs/workers. | Drain and stop workers before removing. |
| `InstanceActiveError` | `INSTANCE_ACTIVE` | `removeInstance` refused because the instance is still live. | Pause/stop the instance first, then remove. |
| `ShutdownTimeoutError` | `SHUTDOWN_TIMEOUT` | Graceful shutdown didn't finish within `timeoutSeconds`. | Raise the timeout or make handlers honor `job.signal`. |
| `MissingPeerDependencyError` | `MISSING_PEER_DEPENDENCY` | The driver's client peer dep isn't installed. | Install the peer shown in the message. |

## Diagnose with events

A `try/catch` only covers failures on *your* call path. Everything that happens inside the
worker loops — a handler throwing, a job stalling because an instance died, an internal error
the tool swallows to stay up — surfaces as an [event](./events-hooks/events.md), never an
exception. Subscribe on the client to watch it live and wire it to your logs/metrics:

```ts
import { PortQueueEvent } from '@portqueue/core';

// The catch-all: any swallowed internal error surfaces here. Subscribe to this in production.
pq.on(PortQueueEvent.ERROR, ({ error, source }) => {
  logger.error('portqueue internal error', { source, error });
});

// Follow a failing job through its retries.
pq.on(PortQueueEvent.JOB_FAILED, ({ queue, jobId, error, retryAttempt }) => {
  logger.warn('job failed', { queue, jobId, retryAttempt, error });
});
```

When a symptom is fuzzy, the fastest diagnosis is to watch the right event:

| Symptom | Watch | What it tells you |
|---|---|---|
| Something "just doesn't work" but nothing throws | `ERROR` | A swallowed internal error — the single most valuable subscription. |
| A handler keeps re-running | `JOB_FAILED`, `JOB_RETRYING` | The handler is throwing; inspect `error` and `retryAttempt`. |
| Jobs go quiet, then reappear | `JOB_STALLED` | A lock lapsed (instance died or the handler ran past `lockDurationSeconds`); another instance reclaims it. |
| An enqueue seems to do nothing | `JOB_ADDED` (`deduplicated: true`) | The job was deduped by `idempotencyKey` / `singletonKey`. |
| Throughput collapses under load | `SYSTEM_PRESSURE_HIGH` / `_NORMAL` | Backpressure engaged — see [Rate limiting](./guides/rate-limiting.md). |
| A schedule never fires | `SCHEDULE_FIRED` (absent) | The definition isn't active, or no instance is running the queue. |

Listeners are non-blocking and receive one typed payload object — see the full
[events reference](./events-hooks/events.md) for every event and its fields. To *block or
change* an operation rather than observe it, use a [hook](./events-hooks/hooks.md) instead.

## Common situations

- **A handler keeps re-running** — it's throwing. Watch `JOB_FAILED` / `JOB_RETRYING` and
  inspect the `error`. Failed jobs stay in the `job` table (there is no dead-letter queue), so
  you can inspect them and `retryJob`.
- **Nothing is processing** — the queue may be paused (`QUEUE_PAUSED`), or no worker is
  registered on any instance. Confirm a worker tier is running the queue (watch `WORKER_STARTED`).
- **Jobs are never picked up** — a job sits enqueued forever with no `JOB_ACTIVE`. Usual causes:
  - **Affinity mismatch** — the job's `preferredInstanceKeyPattern` matches no *live* instance,
    so nothing is eligible to run it. It waits indefinitely until a matching `instanceKey` comes
    online. Widen the pattern or start an instance whose key matches.
  - **Queue paused** — the queue is paused with `PauseMode.PROCESSING`, so `add` still succeeds
    but nothing dequeues. Resume it.
  - **No worker started** — no worker is registered for that queue on any running instance. Start
    a worker (watch `WORKER_STARTED`).
- **Schema / table-prefix mismatch** — a CLI invocation or a second app sees no queues/jobs (or
  raises `SCHEMA_VERSION_MISMATCH`) even though the primary app is busy. This happens when the
  `--table-prefix` / `--schema` / `--namespace` given to the CLI (or a second driver) differs
  from what the app's driver actually uses, so they read *different tables*. Make the prefix,
  schema, and namespace match the app's driver configuration exactly.
- **Jobs stall or run twice** — an instance died mid-job. The lock lapses after `lockDurationSeconds`
  and another instance reclaims the job (`JOB_STALLED`). Make long handlers honor `job.signal`
  so they stop when their lock is lost.
- **Silent failures** — always subscribe to `PortQueueEvent.ERROR`; swallowed internal errors
  surface only there.
- **Schema errors on boot** — `SCHEMA_VERSION_MISMATCH`. Run `portqueue migrate` (see
  [Going to Production](./production.md)).
