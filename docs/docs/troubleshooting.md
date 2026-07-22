---
id: troubleshooting
title: Troubleshooting
sidebar_label: Troubleshooting
---

# Troubleshooting

Errors are typed. Catch `PortQueueError` (the base) and branch on `error.code`
(`PortQueueErrorCode`) — never on message strings.

```ts
import { PortQueueError, PortQueueErrorCode } from '@portqueue/core';

try {
  await pq.createQueue('emails').addJob({ data });
} catch (err) {
  if (err instanceof PortQueueError && err.code === PortQueueErrorCode.QUEUE_PAUSED) {
    // handle the specific case
  }
}
```

## Keyed by `PortQueueErrorCode`

| Code | Error class | What it means & the fix |
|---|---|---|
| `NOT_STARTED` | `NotStartedError` | You called a method before `await pq.init()`. Await `init()` first. |
| `ALREADY_STARTED` | — | `init()` called twice with intervening state change. `init()` is idempotent; call it once. |
| `ALREADY_STOPPED` | — | Operation after `shutdown()`. Create a new client or don't use it post-shutdown. |
| `INVALID_OPTIONS` | `InvalidOptionsError` | An options object failed validation (e.g. both `cron` and `every`, or `delay` + `startAfter`). Read the message; it names the offending field. |
| `UNSUPPORTED_CAPABILITY` | `UnsupportedCapabilityError` | The driver's engine can't do what you asked. Use a driver that supports it or the documented fallback. |
| `UNSUPPORTED_FOR_WORKER_TYPE` | `UnsupportedForWorkerTypeError` | Step control on a single-`handler` worker (or vice-versa). Match the call to the worker type. |
| `IDEMPOTENCY_CONFLICT` | — | An `idempotencyKey` matched an existing job. Usually expected — inspect `result.deduplicated` instead of catching. |
| `SINGLETON_CONFLICT` | — | A `singletonKey` already has an active job. Expected under contention; retry later or rely on dedup. |
| `SCHEMA_VERSION_MISMATCH` | `SchemaVersionMismatchError` | The DB schema version differs from the library's. Run `portqueue migrate` (see [Production](./production.md)). |
| `MIGRATION_FAILED` | `MigrationFailedError` | A migration step errored. Check DB permissions and the underlying error; re-run migrate. |
| `MIGRATION_CHECKSUM_MISMATCH` | — | A previously applied migration's checksum changed — a tampered/edited migration. Do not hand-edit applied migrations. |
| `DRIVER_CONNECTION_ERROR` | `DriverConnectionError` | Couldn't connect. Check connection string, network, credentials, and that the DB client peer dep is installed. |
| `DRIVER_QUERY_ERROR` | `DriverQueryError` | A query failed at the engine. Inspect the wrapped cause; often a permissions or schema issue. |
| `JOB_NOT_FOUND` | `JobNotFoundError` | No job for the given `jobId` (removed by retention, or wrong id). |
| `QUEUE_NOT_FOUND` | — | Referenced a queue that was never ensured. Call `createQueue` first. |
| `QUEUE_PAUSED` | `QueuePausedError` | `add` refused because the queue is paused with `PauseMode.ALL`. Resume it, or expect this during a drain. |
| `PAYLOAD_TOO_LARGE` | `PayloadTooLargeError` | Serialized `data` exceeded `maxPayloadBytes`. Shrink the payload (store large blobs elsewhere, pass a reference). |
| `SHUTDOWN_TIMEOUT` | `ShutdownTimeoutError` | Graceful shutdown didn't drain within `timeoutMs`. Raise the timeout or make long handlers honor `job.signal`. |
| `MISSING_PEER_DEPENDENCY` | `MissingPeerDependencyError` | The driver's client (e.g. `pg`, `better-sqlite3`) isn't installed. Install the peer shown in the message. |

## Common situations

- **A handler keeps re-running:** it likely throws; check `PortQueueEvent.JOB_FAILED` /
  `ERROR`. Failed jobs stay in `job` (no dead-letter queue) — inspect and `retryJob`.
- **Nothing is processing:** the queue may be paused (`QUEUE_PAUSED`) or no worker is
  registered on any instance. Confirm a worker tier exists.
- **Silent failures:** always subscribe to `PortQueueEvent.ERROR` — swallowed internal
  errors surface there.
