# 09 — Transactions

PortQueue must let a developer enqueue a job **as part of their own database transaction**, so the job exists if and only if the surrounding business write commits. This is a headline feature (the raw plan calls it out and says "check how pg-boss does it, implement better").

## 09.1 The problem this solves

The classic dual-write bug: you `INSERT` a business row and enqueue a job in two separate operations. If the process crashes between them, you get a job with no row, or a row with no job. Because PortQueue stores jobs in the *same database*, we can make enqueue **participate in the caller's transaction** — atomic, no outbox pattern needed.

## 09.2 `TransactionHandle` — the abstraction

Core defines a `TransactionHandle`: an opaque, driver-produced object representing an open transaction/connection that `insertJob`/`insertJobs`/`upsertSchedule`/etc. can run on. Two ways to obtain one:

1. **PortQueue-managed** — `pq.transaction(fn)`:
   - `pq.transaction<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T>` opens a transaction via the driver, passes the handle to `fn`, commits on resolve, rolls back on throw.
   - Inside `fn`, the developer does their own writes *through the same connection* (the handle exposes the raw driver connection/executor for that, typed per engine) **and** calls `queue.add({ data, tx })`. Everything commits or rolls back together.

2. **Adopt an external transaction** — `pq.adoptTransaction({ external })`:
   - The developer already has a transaction from their own code (a `pg` client mid-`BEGIN`, a `better-sqlite3` transaction, an `oracledb` connection, a Knex/TypeORM `QueryRunner`, etc.). They pass it and get a `TransactionHandle` to hand to `queue.add({ tx })`.
   - The driver's `adoptTransaction` wraps the native object so `insertJob` executes on it. **PortQueue does not commit/rollback an adopted transaction** — the owner does. We only issue our INSERT on their connection.
   - Each driver documents exactly what native types it accepts for `external`.

## 09.3 API surface (already threaded through file 05)

- Every producing method (`add`, `addBulk`, `schedule`, `unschedule`, `remove`, `cancel`, `setQueuePaused`, …) accepts an optional `tx?: TransactionHandle` in its options object.
- When `tx` is present, the operation runs on that transaction and **does not fire a NOTIFY until commit** (09.5).
- When `tx` is absent, the operation runs autonomously (its own short transaction) exactly as before.

## 09.4 How this is "better than pg-boss"

- **Both directions supported**: managed (`pq.transaction`) *and* adopt-external (`adoptTransaction`), so it fits whether PortQueue or the app owns the connection.
- **Driver-agnostic**: the same `tx` option works on every engine (each driver knows how to run on its native transaction). pg-boss is Postgres-only.
- **Typed**: `TransactionHandle` is a real type; the external-adoption accepts a typed union per driver rather than `any`.
- **Notify-after-commit** is handled for you (below), avoiding the pg-boss foot-gun where a NOTIFY fired inside a transaction that later rolls back wakes workers for a job that doesn't exist.

## 09.5 Notify-after-commit (correctness detail)

If we fired the "new job" NOTIFY *inside* the caller's transaction, a rollback would leave workers chasing a phantom job, and a commit-then-crash could drop the notify. Rules:

- For `tx`-based enqueues, the notify is **deferred until commit**:
  - In `pq.transaction(fn)`, PortQueue registers the pending notify and fires it after its own commit succeeds.
  - For `adoptTransaction`, PortQueue cannot know when the caller commits, so it does one of: (a) if the native tx exposes a commit hook/`afterCommit` (some clients/ORMs do), attach the notify there; (b) otherwise, **rely on the safety poll** to pick up the job shortly after commit, and document this small added latency for adopted transactions. Correctness is preserved either way because the poll is authoritative.
- Missing a notify is never a correctness problem (the poll backstops it); firing a notify for an uncommitted/rolled-back job *would* be — so we err toward deferring.

## 09.6 Transactions and multi-step / retries

- Enqueue-in-transaction concerns **producing** a job. Handler execution and retries run in PortQueue's own transactions, independent of the caller.
- A handler *may* start its own transaction internally (that's the developer's business logic); PortQueue does not wrap the handler in the caller's enqueue transaction.

## 09.7 Capability gating

- Requires `DriverCapability.TRANSACTIONS` (all four first-party drivers have it). A custom driver lacking it throws `UnsupportedCapabilityError` from `runInTransaction`/`adoptTransaction` with guidance.

## 09.8 Local final-check checklist

- [ ] `pq.transaction(fn)` (managed) and `pq.adoptTransaction({ external })` (adopt) both exist and are documented per driver.
- [ ] Every producing method accepts `tx?`; enqueue is atomic with the caller's writes.
- [ ] NOTIFY is deferred to after commit (managed) or backstopped by the poll (adopted); never fired for uncommitted work.
- [ ] `TransactionHandle` and the external-adoption input are typed per driver; no `any`.
- [ ] PortQueue never commits/rolls back an adopted transaction — the owner does.
