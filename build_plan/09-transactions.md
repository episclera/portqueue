# 09 — Transactions

PortQueue must let a developer enqueue a job **as part of their own database transaction**, so the job exists if and only if the surrounding business write commits. This is a headline feature (the raw plan calls it out and says "check how pg-boss does it, implement better").

## 09.1 The problem this solves

The classic dual-write bug: you `INSERT` a business row and enqueue a job in two separate operations. If the process crashes between them, you get a job with no row, or a row with no job. Because PortQueue stores jobs in the *same database*, we can make enqueue **participate in the caller's transaction** — atomic, no outbox pattern needed.

## 09.2 `TransactionHandle` + adapters — the abstraction

Core defines a `TransactionHandle`: an opaque object that `insertJob`/`insertJobs`/`upsertSchedule`/etc. can run their statements on. **PortQueue never begins, commits, or rolls back a transaction** — the developer owns their transaction with their own ORM/query-builder; we only issue our `INSERT`/`UPDATE` on it. There is **no `pq.transaction(fn)`** (managed) and **no `pq.adoptTransaction(...)`** method — the *only* way to enqueue transactionally is to pass a `tx` produced by an **adapter**.

An **adapter** is a tiny pure function that wraps a native transaction/connection into a `TransactionHandle` (the pattern pg-boss popularized with things like `fromKnex`). The developer starts their transaction as they always would, wraps it, and passes it:

```ts
await knex.transaction(async (trx) => {
  await trx('orders').insert(order);
  await pq.createQueue('fulfillment').addJob({ data: { orderId }, tx: fromKnex(trx) });
});   // trx commits → both the row and the job land, atomically; trx rolls back → neither
```

**First-party adapters** (exported from the `@portqueue/core/tx` subpath; peer-dep-free — they only touch the object you pass):
- ORMs: `fromTypeorm(em | queryRunner)`, `fromPrisma(txClient)` (interactive transaction), `fromSequelize(t)`, `fromMikroOrm(em)`.
- Query builders: `fromKnex(trx)`, `fromKysely(trx)`, `fromDrizzle(tx)`.
- Raw clients: `fromPg(client)` (`pg` `PoolClient`/`Client` mid-`BEGIN`), `fromBetterSqlite3(db)`, `fromNodeSqlite(db)`, `fromOracle(connection)`.

Each adapter documents the exact native type it accepts and simply exposes "run this parameterized statement on this connection." Writing a custom one is trivial and documented (implement the small `TransactionHandle` contract). When no `tx` is passed, the producing method runs autonomously in its own short transaction.

## 09.3 API surface (already threaded through file 05)

- Every producing method (`addJob` — including a scheduled `addJob`, `addJobs`, `removeJob`, `removeSchedule`, `cancelJob`, `pauseQueue`, …) accepts an optional `tx?: TransactionHandle` in its options object.
- When `tx` is present, the operation runs on that transaction and **does not fire a NOTIFY until commit** (09.5).
- When `tx` is absent, the operation runs autonomously (its own short transaction) exactly as before.

## 09.4 How this is "better than pg-boss"

- **Adapter for every popular stack**, not just one: TypeORM/Prisma/Sequelize/MikroORM, Knex/Kysely/Drizzle, and raw `pg`/`better-sqlite3`/`node:sqlite`/`oracledb` — plus a documented contract to write your own. pg-boss is Postgres-only and exposes far fewer entry points.
- **The developer always owns the transaction.** We never open/commit/rollback, so there's no confusion about who controls the boundary and no risk of PortQueue committing your business writes early. (This is why the managed `pq.transaction` and `adoptTransaction` were dropped — one model, not three.)
- **Driver-agnostic + typed**: the same `tx` option works on every engine; each adapter accepts a typed native handle rather than `any`.
- **Notify-after-commit** is handled for you (below), avoiding the pg-boss foot-gun where a NOTIFY fired inside a transaction that later rolls back wakes workers for a job that doesn't exist.

## 09.5 Notify-after-commit (correctness detail)

If we fired the "new job" NOTIFY *inside* the caller's transaction, a rollback would leave workers chasing a phantom job, and a commit-then-crash could drop the notify. Because PortQueue does **not** own the transaction, it cannot know exactly when the caller commits, so for `tx`-based enqueues it does one of:
- (a) if the adapter's native handle exposes a commit hook/`afterCommit` (Knex, Sequelize, TypeORM, and others do), the adapter attaches the deferred notify there;
- (b) otherwise, **rely on the safety poll** to pick up the job shortly after commit — documented as a small added latency for that adapter.

Missing a notify is never a correctness problem (the poll backstops it); firing a notify for an uncommitted/rolled-back job *would* be — so we err toward deferring.

## 09.6 Transactions and workflows / retries

- Enqueue-in-transaction concerns **producing** a job (including starting a workflow run). Handler execution, retries, and the atomic workflow step advance (`advanceWorkflowStep`, files 03/06) run in PortQueue's own transactions, independent of the caller.
- A handler *may* start its own transaction internally (that's the developer's business logic); PortQueue does not wrap the handler in the caller's enqueue transaction.

## 09.7 Capability gating

- Requires `DriverCapability.TRANSACTIONS` (all four first-party drivers have it). Passing a `tx` to a driver that lacks it throws `UnsupportedCapabilityError` with guidance.

## 09.8 Local final-check checklist

- [ ] No `pq.transaction(fn)` and no `pq.adoptTransaction(...)` — the only transactional path is passing a `tx` produced by an adapter.
- [ ] Adapters ship for the popular ORMs/query-builders (`fromKnex`/`fromTypeorm`/`fromPrisma`/`fromDrizzle`/`fromKysely`/`fromSequelize`/`fromMikroOrm`) and raw clients (`fromPg`/`fromBetterSqlite3`/`fromNodeSqlite`/`fromOracle`); a documented contract lets devs write their own.
- [ ] Every producing method accepts `tx?`; enqueue is atomic with the caller's writes.
- [ ] NOTIFY is deferred to after the caller's commit (via the adapter's commit hook where available) or backstopped by the poll; never fired for uncommitted work.
- [ ] `TransactionHandle` and each adapter's input are typed; no `any`.
- [ ] PortQueue never begins/commits/rolls back a transaction — the developer owns it.
