/**
 * The handle `pq.createQueue({ name })` returns.
 *
 * **It has no methods.** Like `Worker`, it is a *registration*, not a control surface: creating it
 * declares the queue in this process — its default job options, its retention policy, its
 * queue-scoped hooks — and everything you then *do* with the queue lives on `PortQueue`:
 * `pq.addJob({ queue })`, `pq.getJobs({ queue })`, `pq.pauseQueue({ queue })`, and so on.
 *
 * Two reasons that is the better surface, both learned from the version that had chained methods:
 *
 * - **Nothing silently escapes its scope.** `queue.getJob({ jobId })` forwarded to an unscoped read,
 *   so asking one queue's handle for another queue's job returned it — typed as *this* queue's
 *   payload. With one `pq.getJob({ jobId })` there is no scope to be wrong about, and the reads that
 *   genuinely are per-queue take `queue` as a named argument that means exactly what it says.
 * - **One import, one object.** Application code that touches five queues passes five names to one
 *   `pq` instead of threading five handles through its own plumbing.
 */
export class Queue<TData = unknown> {
  constructor(readonly name: string) {}

  /**
   * The payload type this handle was created with. Never read at runtime — it exists so
   * `createQueue<Payload>({ name })` keeps `Payload` attached to the handle for a caller who wants
   * to pass the type around, and so `TData` is not an unused parameter.
   */
  declare readonly __data?: TData;
}
