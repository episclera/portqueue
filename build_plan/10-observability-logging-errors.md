# 10 — Observability: Logging, Errors & Fault Tolerance

The raw plan is emphatic: **never crash**, **log everything at the right level**, and **give great error messages, not generic ones**. This file defines the logger contract, the error taxonomy, and the fault-tolerance guarantees.

## 10.1 Logger contract

- `Logger` is an **interface**, injected at construction (`PortQueueOptions.logger`). Core never imports a logging library.
  - Methods: `trace/debug/info/warn/error/fatal(message: string, context?: LogContext)`. `LogContext` is a typed object (`{ queue?, jobId?, scheduleId?, instanceId?, err?, ... }`) — structured logging, no positional interpolation.
  - A `LogLevel` enum (`TRACE|DEBUG|INFO|WARN|ERROR|FATAL`) and a `level` setting gate output.
- **Default logger** (`ConsoleLogger`, zero-dep): writes structured lines to stdout/stderr honoring `level`. Good enough out of the box.
- **Bring-your-own**: pass any object implementing `Logger` (a thin adapter over pino/winston/bunyan lives in the app, not in core). Docs show a pino adapter example.
- Every service receives the logger via DI and logs with consistent context keys so operators can filter by `jobId`/`queue`/`instanceId`.

### What is logged at which level
- `TRACE/DEBUG` — claim cycles, notify/poll ticks, lock extensions, backoff calculations, monitor samples.
- `INFO` — client start/stop, migrations applied, worker start/stop, queue pause/resume, schedule fired.
- `WARN` — job stalled/reclaimed, system pressure high, retryable handler failure (attempt < max), notify-unavailable-falling-back-to-poll.
- `ERROR` — terminal job failure (dead-letter), driver errors, hook/listener exceptions, migration failure.
- `FATAL` — unrecoverable startup errors (bad config, incompatible schema in `VALIDATE_ONLY`).

## 10.2 Error taxonomy (typed, coded)

All errors thrown by the public surface extend a base `PortQueueError` with:
- `code: PortQueueErrorCode` (enum — importable, no magic strings),
- `message` — specific and actionable (see 10.4),
- `context` — typed details (queue, jobId, capability, etc.),
- `cause` — the underlying error where relevant (`Error.cause`).

`PortQueueErrorCode` (representative set):
- `NOT_STARTED` — used a client before `start()`.
- `ALREADY_STARTED` / `ALREADY_STOPPED`.
- `INVALID_OPTIONS` — bad option combination (e.g. both `cron` and `every`, or both `delay` and `startAfter`).
- `UNSUPPORTED_CAPABILITY` — driver lacks a required capability (`UnsupportedCapabilityError`).
- `UNSUPPORTED_FOR_WORKER_TYPE` — step control on a single-function worker, or vice-versa.
- `IDEMPOTENCY_CONFLICT` (only where surfaced rather than deduped), `SINGLETON_CONFLICT`.
- `SCHEMA_VERSION_MISMATCH` — `VALIDATE_ONLY` found the DB behind/ahead; message includes the exact migrate command.
- `MIGRATION_FAILED`, `MIGRATION_CHECKSUM_MISMATCH`.
- `DRIVER_CONNECTION_ERROR`, `DRIVER_QUERY_ERROR` (wraps native driver errors).
- `JOB_NOT_FOUND`, `QUEUE_NOT_FOUND`.
- `SHUTDOWN_TIMEOUT`.

Dedicated subclasses for the ones developers branch on (`UnsupportedCapabilityError`, `SchemaVersionMismatchError`, `InvalidOptionsError`, …) so `catch (e) { if (e instanceof UnsupportedCapabilityError) ... }` works, in addition to the `code` field.

## 10.3 Fault tolerance guarantees

The worker loop must be **uncrashable**:
- Handler throws → caught by `ExecutionService` → routed to retry/fail (file 06). Never propagates to the loop.
- Handler returns a rejected promise, throws synchronously, or throws a non-Error value → all normalized to a `PortQueueError`-wrapped failure with the original preserved as `cause`.
- Handler **hangs** → the visibility timeout + heartbeat detect a stall; the job is reclaimable. A handler that ignores `job.signal` on shutdown is abandoned after `timeoutMs` and its lock released.
- **Event listener / hook throws** → caught, logged, surfaced via `PortQueueEvent.ERROR`; loop continues (file 08).
- **Driver/DB error mid-claim** → caught, logged at `ERROR`, the claim cycle backs off (exponential, capped) and retries; the process does not exit. If the DB is down, workers idle-retry until it returns.
- **Unhandled rejection safety**: internal async paths always attach a `.catch`; the library never relies on the app's `unhandledRejection` handler. Document that the app should still have one.
- The only place PortQueue intentionally throws to the caller is **synchronous misuse** (bad options, using before start) and **`start()`/migration** failures — i.e. programmer/config errors surfaced early, not runtime job errors.

## 10.4 Error-message quality (a hard rule)

Every thrown message must state **what happened, why, and how to fix it** — never a bare "invalid argument." Examples of the required tone:

- ❌ `"invalid options"`
- ✅ `"Cannot set both 'cron' and 'every' on a schedule (queue 'reports', key 'daily'). A schedule is either cron-based or fixed-interval — pass exactly one."`
- ✅ `"Driver 'sqlite' does not support LISTEN/NOTIFY; PortQueue is using interval polling (pollIntervalMs=1000). This is expected and safe. To reduce latency, lower pollIntervalMs or use a driver with the LISTEN_NOTIFY capability."` (a warning log, not an error)
- ✅ `"Database schema is at version 3 but @portqueue/core@1.4.0 expects version 5. Run 'npx portqueue migrate' (or set migration: MigrationMode.AUTO). Startup aborted because migration mode is VALIDATE_ONLY."`

Docs (file 15) include a troubleshooting page keyed by `PortQueueErrorCode`.

## 10.5 Metrics-friendly surface

- Counts/throughput come from `StatsService` (DB-backed) — used by dashboard/CLI and available to devs (`pq.getStats`).
- Events (file 08) are the integration point for external metrics/tracing: the app can subscribe and push to Prometheus/OpenTelemetry from its own code. Core stays dependency-free; docs show an OTel example in app-space.

## 10.6 Local final-check checklist

- [ ] `Logger` is an injected interface; core imports no logging library; a zero-dep default exists.
- [ ] Structured logging with consistent context keys; levels used per 10.1.
- [ ] All public errors extend `PortQueueError` with an enum `code`, typed `context`, and `cause`; key ones have subclasses.
- [ ] The worker loop cannot be crashed by any handler/listener/hook/driver error.
- [ ] Error messages state what/why/how-to-fix; a troubleshooting page maps codes to fixes.
- [ ] The only caller-facing throws are misuse and startup/migration failures.
