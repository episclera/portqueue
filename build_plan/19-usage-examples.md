# 19 — Usage Examples (scenarios → the exact API they need)

Worked scenarios showing how a developer uses PortQueue and **which methods/options each needs**. These validate that the public API (file 05) actually covers real use cases cleanly. Snippets are illustrative of the *shape* (named options, enums, result objects) — not final code.

## 19.1 Basic: send emails in the background

**Need:** enqueue from an API, process on a worker. `PortQueue`, `queue.add`, `pq.createWorker`.

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const pq = new PortQueue({ driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }) });
await pq.start();

// producer (API tier)
const emails = pq.queue<{ to: string; template: string }>('emails');
const res = await emails.add({ data: { to: 'a@b.com', template: 'welcome' } });
// res: { jobId, queue: 'emails', status: JobStatus.PENDING, deduplicated: false, startAfter }

// consumer (worker tier — a different process/deployment)
const worker = pq.createWorker({
  queue: 'emails',
  concurrency: 20,
  handler: async (job) => { await sendEmail(job.data); },
});
await worker.start();
```
**Deployment shape:** the API tier calls `pq.queue(...).add(...)` and never `createWorker`; the worker tier calls `createWorker`. Same `@portqueue/core`, split by which methods you call.

## 19.2 Delayed and priority jobs

**Need:** send a reminder in 24h; process urgent ones first. `JobOptions.delay`, `JobOptions.priority`.

```ts
await emails.add({ data, delay: '24h' });                 // Duration string
await emails.add({ data, priority: 10 });                 // higher runs sooner
await emails.add({ data, startAfter: new Date('2026-08-01T09:00:00Z') });
```

## 19.3 Idempotent enqueue (don't double-charge)

**Need:** enqueue a payment job exactly once per order even if the request retries. `JobOptions.idempotencyKey` + `AddJobResult.deduplicated`.

```ts
const r = await pq.queue('payments').add({ data: { orderId }, idempotencyKey: `charge:${orderId}` });
if (r.deduplicated) logger.info('charge already queued', { jobId: r.jobId });
```

## 19.4 Transactional enqueue (no dual-write bug)

**Need:** create an order row and queue its fulfillment atomically. `pq.transaction` (or `adoptTransaction`) + `tx` option (file 09).

```ts
await pq.transaction(async (tx) => {
  await tx.query('INSERT INTO "order" (...) VALUES (...)');  // developer's own write on the same tx
  await pq.queue('fulfillment').add({ data: { orderId }, tx });
});
// job exists iff the order insert committed; NOTIFY fires only after commit
```
Adopting an existing transaction:
```ts
const handle = pq.adoptTransaction({ external: myPgClientInTx });
await pq.queue('fulfillment').add({ data, tx: handle });   // app owns commit/rollback
```

## 19.5 Retries with backoff + dead-letter

**Need:** retry a flaky webhook 5×, exponential, then dead-letter. `JobOptions.retryMaxAttempts/retryDelay/retryBackoff`, `QueueOptions.deadLetterQueue`.

```ts
const webhooks = pq.queue('webhooks', { deadLetterQueue: 'webhooks.dead' });
await webhooks.add({
  data,
  retryMaxAttempts: 5,
  retryDelay: '2s',
  retryBackoff: { strategy: BackoffStrategy.EXPONENTIAL, factor: 2, maxDelay: '5m', jitter: true },
});
// after 5 failures: job FAILED + dead_letter=true, and a job enqueued on 'webhooks.dead'
```

## 19.6 Recurring / cron jobs with timezone

**Need:** generate a report every weekday at 08:00 New York time. `queue.schedule` with `cron` + `timezone`; runs share `scheduleId`.

```ts
const r = await pq.queue('reports').schedule({
  key: 'daily-sales',
  cron: '0 8 * * 1-5',
  timezone: 'America/New_York',
  data: { kind: 'sales' },
  jobOptions: { priority: 5 },
});
// r.scheduleId is stamped on every produced job; dashboard groups runs by it
```
Fixed interval instead:
```ts
await pq.queue('healthchecks').schedule({ key: 'ping', every: '30s', data: {} });
```

## 19.7 Multi-step, resumable pipeline

**Need:** an order pipeline — validate → charge → ship → notify — that resumes mid-way after a crash. `steps` worker + `StepOutcome` (file 06).

```ts
enum OrderStep { VALIDATE = 'VALIDATE', CHARGE = 'CHARGE', SHIP = 'SHIP', NOTIFY = 'NOTIFY' }

pq.createWorker({
  queue: 'orders',
  // ordered array — array order is the canonical sequence; steps[0] is the initial step
  steps: [
    { id: OrderStep.VALIDATE, handler: async (job, step) => step.next(OrderStep.CHARGE, { data: await validate(job.data) }) },
    { id: OrderStep.CHARGE,   handler: async (job, step) => step.next(OrderStep.SHIP,   { data: await charge(job.lastStepReturnValue) }) },
    { id: OrderStep.SHIP,     handler: async (job, step) => step.next(OrderStep.NOTIFY, { data: await ship(job.lastStepReturnValue) }) },
    { id: OrderStep.NOTIFY,   handler: async (job, step) => step.done(await notify(job.lastStepReturnValue)) },
  ],
});
// produce:
await pq.queue('orders').add({ data: { cartId }, /* starts at steps[0] = VALIDATE */ });
```
If the process dies after `CHARGE`, another instance resumes at `SHIP` using persisted `lastStepReturnValue` — no re-charge, no lost progress. `step.repeat({ delayMs })` re-runs a step (e.g. poll a shipment status until ready).

## 19.8 Concurrency + rate limiting + backpressure

**Need:** call a 3rd-party API at most 100/min across the fleet, 10 at a time locally, and back off when the box is hot. `WorkerOptions.concurrency/limiter`, `QueueOptions.rateLimit`, `SystemMonitorOptions`.

```ts
const pq = new PortQueue({
  driver,
  monitor: { maxEventLoopDelayMs: 200, maxCpuPercent: 85, resumeHysteresis: '5s' },
});
const api = pq.queue('third-party', { rateLimit: { max: 100, duration: '1m' } });  // cluster-wide
pq.createWorker({
  queue: 'third-party',
  concurrency: 10,
  limiter: { max: 50, duration: '1m' },   // this worker's local cap
  respectSystemPressure: true,
});
```

## 19.9 Graceful shutdown

**Need:** finish in-flight jobs on SIGTERM. `pq.stop`, `job.signal`.

```ts
process.on('SIGTERM', async () => { await pq.stop({ graceful: true, timeoutMs: 30_000 }); process.exit(0); });
// long handlers observe job.signal to bail if the timeout is hit
```

## 19.10 Pause a queue from accepting/handling (ops)

**Need:** stop processing during an incident but keep accepting jobs. `queue.pause({ mode })` (persisted across instances).

```ts
await pq.queue('emails').pause({ mode: PauseMode.PROCESSING }); // still stored, not handled
// ...later
await pq.queue('emails').resume();
```

## 19.11 Observe events / push metrics

**Need:** count failures, trace processing. `pq.on(PortQueueEvent.X)` + hooks (file 08).

```ts
pq.on(PortQueueEvent.JOB_FAILED, ({ queue, jobId, error, deadLetter }) => metrics.failures.inc({ queue }));
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
// every queue.add / createWorker / schedule call above works identically
```
Custom driver: implement the `Driver` interface, validate with the conformance kit (`@portqueue/core/conformance`), pass `new PortQueue({ driver: myDriver })`.

## 19.15 Coverage check (does the API cover the raw plan?)

- concurrency ✔ (19.8) · rate limiting ✔ (19.8) · monitoring/backpressure ✔ (19.8) · events ✔ (19.11) · horizontal scale ✔ (19.1 deployment split + file 07) · transactional ✔ (19.4) · pub/sub ✔ (implicit, drives 19.1) · delayed ✔ (19.2) · cron+tz ✔ (19.6) · idempotency ✔ (19.3) · multi-step resumable ✔ (19.7) · priority ✔ (19.2) · retries/backoff/DLQ ✔ (19.5) · retention ✔ (job/queue `retention` option) · graceful shutdown ✔ (19.9) · pause accept/handle ✔ (19.10) · dashboard ✔ (19.12) · CLI incl. serve+listen ✔ (19.13) · multi-driver + custom ✔ (19.14). Every headline feature has a worked path.
