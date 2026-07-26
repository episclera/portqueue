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
  const emailsQueue = pq.createQueue('emails');
  await emailsQueue.addJob({ data });
} catch (err) {
  if (err instanceof PortQueueError && err.code === PortQueueErrorCode.QUEUE_PAUSED) {
    // handle the specific case
  }
}
```

### Error codes

| Code | Error class | What it means & the fix |
|---|---|---|
| `NOT_STARTED` | `NotStartedError` | You called a method before `await pq.init()`. Await `init()` first. |
| `ALREADY_STARTED` | — | `init()` called twice with intervening state change. `init()` is idempotent; call it once. |
| `ALREADY_STOPPED` | — | Operation after `shutdown()`. Create a new client or don't use it post-shutdown. |
| `INVALID_OPTIONS` | `InvalidOptionsError` | An options object failed validation (e.g. both `schedule.cron` and `schedule.startEverySeconds`, a one-off delay combined with a recurring mode, or a duration that isn't a non-negative number of seconds). Read the message; it names the offending field. |
| `UNSUPPORTED_CAPABILITY` | `UnsupportedCapabilityError` | The driver's engine can't do what you asked. Use a driver that supports it or the documented fallback. |
| `IDEMPOTENCY_CONFLICT` | — | An `idempotencyKey` matched an existing job. Usually expected — inspect `result.deduplicated` instead of catching. |
| `SINGLETON_CONFLICT` | — | A `singletonKey` already has an active job. Expected under contention; retry later or rely on dedup. |
| `SCHEMA_VERSION_MISMATCH` | `SchemaVersionMismatchError` | The DB schema version differs from the library's. Run `portqueue migrate` (see [Going to Production](./production.md)). |
| `MIGRATION_FAILED` | `MigrationFailedError` | A migration step errored. Check DB permissions and the underlying error; re-run migrate. |
| `MIGRATION_CHECKSUM_MISMATCH` | — | A previously applied migration's checksum changed — a tampered/edited migration. Do not hand-edit applied migrations. |
| `DRIVER_CONNECTION_ERROR` | `DriverConnectionError` | Couldn't connect. Check connection string, network, credentials, and that the DB client peer dep is installed. |
| `DRIVER_QUERY_ERROR` | `DriverQueryError` | A query failed at the engine. Inspect the wrapped cause; often a permissions or schema issue. |
| `JOB_NOT_FOUND` | `JobNotFoundError` | No job for the given `jobId` (removed by retention, or wrong id). |
| `QUEUE_NOT_FOUND` | — | Referenced a queue that was never ensured. Call `createQueue` first. |
| `QUEUE_PAUSED` | `QueuePausedError` | `add` refused because the queue is paused with `PauseMode.ALL`. Resume it, or expect this during a drain. |
| `SHUTDOWN_TIMEOUT` | `ShutdownTimeoutError` | Graceful shutdown didn't drain within `timeoutSeconds`. Raise the timeout or make long handlers honor `job.signal`. |
| `MISSING_PEER_DEPENDENCY` | `MissingPeerDependencyError` | The driver's client (e.g. `pg`, `better-sqlite3`) isn't installed. Install the peer shown in the message. |

:::warning No dedicated class for some codes
Rows with `—` in the **Error class** column have **no dedicated subclass**. They are thrown as
the base `PortQueueError` (or a related class) carrying that `code` — there is no
`AlreadyStartedError`, `IdempotencyConflictError`, `QueueNotFoundError`, etc. Always branch on
`err.code`, never `instanceof` a code-specific class you'd expect to exist. (Every error is
still `instanceof PortQueueError`.)
:::

### Exported error classes

Every class below is importable from `@portqueue/core` and extends `PortQueueError`. Each
instance carries `.code` (a `PortQueueErrorCode` string enum value) and `.context` (an object
with the offending fields). Because some codes have no dedicated class (see the note above),
prefer branching on `err.code`.

| Class | `.code` | Meaning | Typical fix |
|---|---|---|---|
| `PortQueueError` | *(any)* | Base class — also thrown directly for codes without a dedicated subclass. | Branch on `err.code`. |
| `NotStartedError` | `NOT_STARTED` | A method was called before `await pq.init()`. | Await `init()` first. |
| `InvalidOptionsError` | `INVALID_OPTIONS` | An options object failed validation. | Read the message; it names the offending field. |
| `UnsupportedCapabilityError` | `UNSUPPORTED_CAPABILITY` | The driver's engine can't do what was asked. | Use a capable driver or the documented fallback. |
| `SchemaVersionMismatchError` | `SCHEMA_VERSION_MISMATCH` | DB schema version differs from the library's. | Run `portqueue migrate`. |
| `MigrationFailedError` | `MIGRATION_FAILED` | A migration step errored. | Check DB permissions and the cause; re-run migrate. |
| `DriverConnectionError` | `DRIVER_CONNECTION_ERROR` | Couldn't connect to the DB. | Check connection string, network, credentials, peer dep. |
| `DriverQueryError` | `DRIVER_QUERY_ERROR` | A query failed at the engine. | Inspect the wrapped cause (permissions/schema). |
| `JobNotFoundError` | `JOB_NOT_FOUND` | No job for the given `jobId`. | Removed by retention or wrong id — re-check the id. |
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
