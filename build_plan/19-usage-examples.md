# 19 — Usage Examples (scenarios → the exact API they need)

Worked scenarios showing how a developer uses PortQueue and **which methods/options each needs**. These validate that the public API (file 05) actually covers real use cases cleanly. Snippets are illustrative of the *shape* (named options, enums, result objects) — not final code.

## 19.1 Basic: send emails in the background

**Need:** enqueue from an API, process on a worker. `PortQueue`, `queue.addJob`, `pq.createWorker`.

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

// one enum names every queue in the app; pass it to PortQueue for type-safe queue names
enum QueueName { Emails = 'emails' }

const pq = new PortQueue<QueueName>({ driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }) });
await pq.init();

// producer (API tier) — TData = payload type; queue name checked against QueueName
const emails = pq.createQueue<{ to: string; template: string }>(QueueName.Emails);
const res = await emails.addJob({ data: { to: 'a@b.com', template: 'welcome' } });
// res: { jobId, queue: 'emails', status: JobStatus.PENDING, deduplicated: false, startAfter }

// consumer (worker tier — a different process/deployment)
// registering the worker is enough — it claims automatically once pq.init() ran.
pq.createWorker({
  queue: QueueName.Emails,
  concurrency: 20,
  handler: async (job) => { await sendEmail(job.data); },
});
```
**Deployment shape:** the API tier calls `pq.createQueue(...).addJob(...)` and never `createWorker`; the worker tier calls `createWorker`. Same `@portqueue/core`, split by which methods you call. To pause/resume handling (cluster-wide) use `pq.createQueue(QueueName.Emails).pause()/.resume()`; to shut a process down, `pq.shutdown()` (the worker has no lifecycle methods of its own — file 05.4). The `QueueName` enum is defined once and shared across both tiers, so a typo or a retired queue is a compile error.

## 19.2 Delayed and priority jobs

**Need:** send a reminder in 24h; process urgent ones first. `JobOptions.delay`, `JobOptions.priority`.

```ts
await emails.addJob({ data, delay: '24h' });                 // Duration string
await emails.addJob({ data, priority: 10 });                 // higher runs sooner
await emails.addJob({ data, startAfter: new Date('2026-08-01T09:00:00Z') });
```

## 19.3 Idempotent enqueue (don't double-charge)

**Need:** enqueue a payment job exactly once per order even if the request retries. `JobOptions.idempotencyKey` + `AddJobResult.deduplicated`.

```ts
const r = await pq.createQueue('payments').addJob({ data: { orderId }, idempotencyKey: `charge:${orderId}` });
if (r.deduplicated) logger.info('charge already queued', { jobId: r.jobId });
```

## 19.4 Transactional enqueue (no dual-write bug)

**Need:** create an order row and queue its fulfillment atomically. Use **your own** transaction + an adapter for the `tx` option (file 09) — PortQueue never owns the transaction.

```ts
import { fromKnex } from '@portqueue/core/tx';

await knex.transaction(async (trx) => {
  await trx('order').insert({ /* ... */ });                     // developer's own write
  await pq.createQueue('fulfillment').addJob({ data: { orderId }, tx: fromKnex(trx) });
});
// job exists iff the order insert committed; NOTIFY fires only after commit
```
Raw `pg` client (or any other adapter — `fromTypeorm`, `fromPrisma`, `fromDrizzle`, `fromKysely`, `fromSequelize`, …):
```ts
import { fromPg } from '@portqueue/core/tx';

await client.query('BEGIN');
await client.query('INSERT INTO "order" (...) VALUES (...)');
await pq.createQueue('fulfillment').addJob({ data, tx: fromPg(client) });
await client.query('COMMIT');                                   // the app owns commit/rollback
```

## 19.5 Retries with backoff

**Need:** retry a flaky webhook 5×, exponential, then give up. `JobOptions.retryMaxAttempts/retryDelay/retryBackoff`.

```ts
const webhooks = pq.createQueue('webhooks');
await webhooks.addJob({
  data,
  retryMaxAttempts: 5,
  retryDelay: '2s',
  retryBackoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2, maxDelay: '5m', jitter: true },
});
// after 5 failed attempts the job is FAILED (terminal) with its failure_message.
// it stays in `job` — inspect via dashboard/CLI (status=FAILED) and re-run with
// webhooks.retryJob({ jobId }) once the downstream is healthy. (No dead-letter queue.)
```

## 19.6 Recurring / cron jobs with timezone

**Need:** generate a report every weekday at 08:00 New York time. Same `addJob` method, with a `schedule` option (`cron` + `timezone`); runs share `scheduleId`.

```ts
const r = await pq.createQueue('reports').addJob({
  data: { kind: 'sales' },            // the template for every produced run
  priority: 5,                        // job options apply to each run
  schedule: {
    key: 'daily-sales',               // idempotent per (queue, key)
    cron: '0 8 * * 1-5',
    timezone: 'America/New_York',
  },
});
// r.scheduleId is stamped on every produced job; dashboard groups runs by it.
// r.jobId is absent (no concrete job yet); r.nextRunAt is the first run time.
```
Fixed interval instead:
```ts
await pq.createQueue('healthchecks').addJob({ data: {}, schedule: { key: 'ping', every: '30s' } });
```
Unschedule with `removeSchedule` (its own method, per the entity-naming rule):
```ts
await pq.createQueue('reports').removeSchedule({ scheduleId: r.scheduleId });
```

## 19.7 Workflow — multi-step, resumable pipeline

**Need:** an order pipeline — validate → charge → ship → notify — that resumes mid-way after a crash. A **workflow** where each step is its own job (files 05/06). Define it once and share the definition across the producer and worker tiers.

```ts
enum OrderStep { VALIDATE = 'VALIDATE', CHARGE = 'CHARGE', SHIP = 'SHIP', NOTIFY = 'NOTIFY' }

// shared module — a single source of truth for step keys + order (pure, no I/O)
export const orderWorkflow = defineWorkflow({
  queue: 'orders',
  // ordered array — order is the canonical sequence; steps[0] is the entry step.
  // a handler for every step; each step's input is job.data (the prior step's output).
  steps: [
    { key: OrderStep.VALIDATE, handler: async (job, step) => step.next({ data: await validate(job.data) }) },
    { key: OrderStep.CHARGE,   handler: async (job, step) => step.next({ data: await charge(job.data) }) },
    { key: OrderStep.SHIP,     handler: async (job, step) => step.next({ data: await ship(job.data) }) },
    { key: OrderStep.NOTIFY,   handler: async (job, step) => step.done({ result: await notify(job.data) }) },
  ],
});

// worker tier — consume (many steps instead of one handler):
pq.createWorker(orderWorkflow);

// producer tier — starting a run is just add({ data }); pass the definition so the
// queue knows its entry step. Same call shape as a simple queue.
const { workflowId } = await pq.createQueue(orderWorkflow).addJob({ data: { cartId } });
```
A workflow queue differs from a simple queue in one way only: its worker has `steps` instead of a single `handler` — **producing is the same `add({ data })`**. Each step is a separate `job` row sharing `workflowId`; when `VALIDATE` finishes it **spawns** the `CHARGE` job (next key computed from declared order — omit `to`, or jump with `step.next({ to: OrderStep.SHIP })`). If the process dies while `CHARGE` runs, that job is reclaimed and re-run on any instance — no re-validate, no lost progress (completed steps are their own `COMPLETED` rows). `step.repeat({ delayMs })` spawns another job for the same step (e.g. poll a shipment status until ready). Inspect the whole run with `pq.getWorkflow({ workflowId })`.

## 19.8 Concurrency + rate limiting + backpressure

**Need:** call a 3rd-party API at most 100/min across the fleet, 10 at a time locally, and back off when the box is hot. `WorkerOptions.concurrency/limiter`, `QueueOptions.rateLimit`, `SystemMonitorOptions`.

```ts
const pq = new PortQueue({
  driver,
  monitor: { maxEventLoopDelayMs: 200, maxCpuPercent: 85, resumeHysteresis: '5s' },
});
const api = pq.createQueue('third-party', { rateLimit: { max: 100, duration: '1m' } });  // cluster-wide
pq.createWorker({
  queue: 'third-party',
  concurrency: 10,
  limiter: { max: 50, duration: '1m' },   // this worker's local cap
  respectSystemPressure: true,
});
```

## 19.9 Graceful shutdown

**Need:** finish in-flight jobs on SIGTERM. `pq.shutdown`, `job.signal`.

```ts
process.on('SIGTERM', async () => { await pq.shutdown({ graceful: true, timeoutMs: 30_000 }); process.exit(0); });
// long handlers observe job.signal to bail if the timeout is hit
```

## 19.10 Pause a queue from accepting/handling (ops)

**Need:** stop processing during an incident but keep accepting jobs. `queue.pause({ mode })` (persisted across instances).

```ts
await pq.createQueue('emails').pause({ mode: PauseMode.PROCESSING }); // still stored, not handled
// ...later
await pq.createQueue('emails').resume();
```

## 19.11 Observe events / push metrics

**Need:** count failures, trace processing. `pq.on(PortQueueEvent.X)` + hooks (file 08).

```ts
pq.on(PortQueueEvent.JOB_FAILED, ({ queue, jobId, error, retryAttempt }) => metrics.failures.inc({ queue }));
pq.useHook({ phase: HookPhase.BEFORE_PROCESS, handler: ({ job }) => tracer.startSpan(job.queue) });
```

## 19.12 Mount the dashboard

**Need:** an ops dashboard on the existing Express app, behind auth. `createDashboard` (file 12).

```ts
import { createDashboard } from '@portqueue/dashboard';
const dash = createDashboard({ portQueue: pq, basePath: '/portqueue', auth: { mode: 'basic', username, password } });
app.use('/portqueue', dash.express());
```
Or serve it from the CLI (no app changes beyond a config module): `portqueue dashboard --config ./portqueue.config.ts --port 9000 --root-user admin --root-password ****`.

## 19.13 Operate from the CLI

**Need:** quick stats and a live event feed. `portqueue stats --watch`, `portqueue listen`.

```bash
# the CLI loads your configured PortQueue from ./portqueue.config.ts (auto-discovered)
portqueue stats --watch
portqueue listen --queue orders   # runs infinitely
portqueue retry --id <jobId> --yes
```

## 19.14 SQLite for a single-node app; custom driver for another engine

**Need:** ship an app on SQLite with zero services; later support a new DB. Swap the driver import — app code unchanged.

```ts
import { SqliteDriver } from '@portqueue/core/drivers/sqlite';
const pq = new PortQueue({ driver: new SqliteDriver({ file: './queue.db' }) });
// every queue.addJob / createWorker / schedule call above works identically
```
Custom driver: implement the `Driver` interface, validate with the conformance kit (`@portqueue/core/conformance`), pass `new PortQueue({ driver: myDriver })`.

## 19.15 Coverage check (does the API cover the raw plan?)

- concurrency ✔ (19.8) · rate limiting ✔ (19.8) · monitoring/backpressure ✔ (19.8) · events ✔ (19.11) · horizontal scale ✔ (19.1 deployment split + file 07) · transactional ✔ (19.4) · pub/sub ✔ (implicit, drives 19.1) · delayed ✔ (19.2) · cron+tz ✔ (19.6) · idempotency ✔ (19.3) · multi-step resumable ✔ (19.7) · priority ✔ (19.2) · retries/backoff ✔ (19.5) · retention ✔ (job/queue `retention` option) · graceful shutdown ✔ (19.9) · pause accept/handle ✔ (19.10) · dashboard ✔ (19.12) · CLI incl. serve+listen ✔ (19.13) · multi-driver + custom ✔ (19.14). Every headline feature has a worked path.
