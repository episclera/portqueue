# 02 — Core Architecture (`@portqueue/core`)

The core is **class-first with dependency injection via `typedi`**, split into small, single-responsibility services grouped by concern. Each big part lives in its own folder and may split further. No long files: if a file grows past a few hundred lines or mixes two concerns, split it.

## 02.1 Design tenets

- **One class, one job.** The scheduler doesn't claim jobs; the claimer doesn't parse cron; the monitor doesn't touch SQL. Services collaborate through injected interfaces.
- **DI containers are per-`PortQueue`-instance, not global.** A process may hold two `PortQueue` instances (e.g. two databases). Use a **scoped container per client** so their services never share state. Never rely on the default global container for instance state.
  - *typedi caveat (raw-plan mandates typedi):* typedi is global-container-oriented; per-instance scoping is done via `Container.of(scopeId)` with a unique scope id per `PortQueue` (and `Container.reset(scopeId)` on `shutdown()` to dispose). This works but is a known sharp edge — services must be resolved from the scoped container, never the default one, and must not use container-global singletons for per-instance state. If typedi's scoping proves too awkward in practice, a thin hand-rolled constructor-injection container is an acceptable fallback (record the deviation in file 20); the public API is unaffected either way.
- **Depend on interfaces, not concretions.** Core services depend on the `Driver` interface (file 03) and a `Logger` interface (file 10), both injected. This is what makes the engine driver-agnostic and testable.
- **No I/O in constructors.** Construction wires dependencies only. All connecting/migrating/listening happens in an explicit `init()` lifecycle.
- **Instance-agnostic.** No service caches anything whose correctness depends on being the only process. In-process caches are allowed only for pure/derived data (e.g. a parsed cron expression), never for claim/dedup/schedule state.

## 02.2 `packages/core/src` folder tree

```
packages/core/src/
  index.ts                       Public barrel — see file 05 for exactly what is exported
  port-queue.ts                  The PortQueue client facade (thin; delegates to services)

  client/
    client-lifecycle.service.ts  start()/stop() orchestration, ordered startup/shutdown
    client-registry.service.ts   tracks live Queue/Worker handles for graceful shutdown & stats
    instance-identity.service.ts resolves this process's instance id + type (container/bare-metal)

  driver/
    driver.interface.ts          The Driver contract (file 03)
    driver-capabilities.ts       Capability enum + capability-set type
    driver-context.ts            Shared value object passed to drivers (schema, prefix, table names)
    base-driver.ts               Optional abstract base with shared, engine-neutral helpers

  drivers/                       First-party drivers (each its own subfolder, own peer client)
    postgres/
    pglite/
    sqlite/
    oracle/
    (shared/)                    SQL fragments/helpers reusable across SQL drivers (file 11)

  schema/
    table-names.ts               TableName enum + prefix/schema resolution (no magic strings)
    schema-definition.ts         Engine-neutral description of tables/columns/indexes
    migration/
      migration-runner.service.ts   Applies ordered migrations, reads/writes migration_state
      migrations/                    Ordered migration steps (per-driver SQL selected via capabilities)

  producer/
    queue.ts                     The Queue producer handle (public; file 05)
    producer.service.ts          Insert/dedup/schedule logic behind Queue
    add-job.service.ts           Builds job rows from options (applies defaults + overrides)

  consumer/
    worker.ts                    The Worker consumer handle (public; file 05)
    claim.service.ts             Claims due jobs (SKIP LOCKED or fallback), respects concurrency
    execution.service.ts         Runs handlers, catches errors, handles retries/steps
    workflow.service.ts         Workflow (multi-step) dispatch + atomic step advance/spawn (file 06)
    completion.service.ts        Marks complete/failed/retry atomically

  scheduling/
    scheduler.service.ts         Turns due schedules into concrete jobs (recurring/cron)
    cron.ts                      Cron parser + next-run calculation (timezone-aware)
    delay.ts                     Delay/startAfter resolution helpers

  pubsub/
    notifier.service.ts          Emits DB notifications on new/changed jobs (LISTEN/NOTIFY)
    subscriber.service.ts        Listens for notifications; falls back to polling when unsupported
    wakeup.ts                    Debounced "there is work" signal that wakes claim loops

  monitoring/
    system-monitor.service.ts    Samples event-loop lag / CPU / memory; sets backpressure state
    rate-limiter.service.ts      Token-bucket limiter (per worker / per queue)
    stats.service.ts             Read-side aggregations for dashboard/CLI

  retention/
    retention.service.ts         Hard-deletes finished jobs from `job` per retention policy

  events/
    event-name.enum.ts           PortQueueEvent enum (file 08)
    event-bus.service.ts         Typed emitter; fan-out to listeners + hooks
    hooks.ts                     Participation-hook registration types (file 08)

  jobs/
    job.ts                       Job context object handed to handlers (public; file 05)
    job-state.enum.ts            JobStatus enum (file 06)
    job-record.ts                Internal row shape ↔ public Job mapping

  errors/
    error-codes.enum.ts          PortQueueErrorCode enum (file 10)
    errors.ts                    Typed error classes (file 10)

  logging/
    logger.interface.ts          Logger contract (file 10)
    console-logger.ts            Default zero-dep logger
    log-level.enum.ts

  options/
    client-options.ts            PortQueueOptions
    queue-options.ts             QueueOptions (definition)
    worker-options.ts            WorkerOptions
    job-options.ts               JobOptions (producer-side per-job)
    option-resolver.ts           Merges queue-level + job-level (job wins)

  util/                          Tiny pure helpers (uuid fallback, backoff math, time) — unit tested
```

Every folder above corresponds to a concern the raw plan explicitly asked to isolate (pub/sub, initialization, job handlers, scheduler, monitoring, retention, migration).

## 02.3 The `PortQueue` facade

`port-queue.ts` is a **thin facade**. It holds the per-instance container, exposes the public methods (file 05), and delegates each to the right service. It contains no business logic itself — this keeps the public class small and readable while the real work stays in focused services.

## 02.4 Runtime lifecycle

`ClientLifecycleService` owns a strict ordered startup and the reverse-ordered shutdown.

**`init()` order:**
1. Resolve **instance identity** (container id / product uuid / type). Cheap, no DB.
2. **Connect** the driver (open pool/handle).
3. **Migrate**: `MigrationRunner` reads `migration_state`, applies any pending migrations for this driver (respects configured schema/prefix). Controlled by `migration` option (`auto` | `manual` | `validate-only`).
4. Start **pub/sub**: `SubscriberService` opens LISTEN (or arms the poller if unsupported).
5. Start the **scheduler** (recurring→concrete jobs) and **retention** service (if configured).
6. Start the **system monitor** (if enabled).
7. Mark client running. Workers created before `init()` begin claiming now; workers created afterwards begin claiming immediately.

**`shutdown({ graceful, timeout })` order (reverse):**
1. Stop accepting new work: scheduler + subscriber stop producing wakeups; producers may still be allowed (configurable — you might drain while still enqueuing).
2. Signal all workers to **stop claiming**; wait for in-flight handlers up to `timeout` (graceful) or cancel/abort (non-graceful).
3. Release claimed-but-unstarted jobs back to the queue.
4. Stop monitor, retention, scheduler.
5. Close LISTEN connections and the driver.
6. Dispose the container.

Details of graceful shutdown semantics are in [`07`](./07-concurrency-scaling-rate-limiting.md).

## 02.5 How a job flows through the services (happy path)

1. `queue.addJob({...})` → `ProducerService` → `AddJobService` builds a row (defaults merged, job-level overrides applied) → `Driver.insertJob` (parameterized) → `NotifierService` fires a notification → returns an `AddJobResult`.
2. On another instance, `SubscriberService` receives the notification (or the poller ticks) → `wakeup` signals `ClaimService`.
3. `ClaimService` claims up to `min(concurrency - active, batchSize)` due jobs for the queue via `Driver.claimJobs` (`SKIP LOCKED` or fallback), respecting the **rate limiter** and **backpressure** from the monitor.
4. For each claimed job, `ExecutionService` builds the `Job` context and runs the handler (or, for a workflow job, dispatches to the step whose key matches `workflow_step_key` via `WorkflowService`), inside a heartbeat that extends the lock.
5. `CompletionService` marks the outcome atomically: complete, schedule a retry (with backoff), or fail terminally (`FAILED`). For a workflow step, `WorkflowService.advanceWorkflowStep` completes this step's job and spawns the next step's job in one transaction (or spawns nothing on `done`). Emits the matching event.
6. `RetentionService` later hard-deletes finished rows from `job` per policy.

## 02.6 Concurrency model (v1)

- Handlers run on the **main event loop** (no worker threads in v1). Concurrency is achieved by running up to N handler promises in flight per worker.
- The `ExecutionService` and `Job` context are shaped so a future threaded/child-process executor is a drop-in `Executor` strategy — see [`20`](./20-roadmap.md). Nothing in the public API assumes single-threaded execution.

## 02.7 Local final-check checklist

- [ ] Each concern is its own service in its own folder; no service reaches into another's internals directly (only via injected interfaces).
- [ ] DI container is per-`PortQueue`-instance; two instances share no state.
- [ ] `PortQueue` facade holds no business logic.
- [ ] Startup and shutdown are strictly ordered and reversible; shutdown is graceful by default.
- [ ] Core depends only on the `Driver` and `Logger` interfaces for I/O — fully testable with the PGLite/SQLite drivers.
- [ ] No service caches claim/dedup/schedule state in-process.
