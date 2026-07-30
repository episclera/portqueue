/**
 * The handle `pq.createQueue({ name })` returns.
 *
 * **It has no methods.** It is a *registration*, not a control surface: the call that produced it
 * declares everything about the queue — its default job options, its retention policy, its
 * queue-scoped hooks, and (when this process consumes the queue) its `handler` and claim settings —
 * and everything you then *do* with the queue lives on `PortQueue`: `pq.addJob({ queue })`,
 * `pq.getJobs({ queue })`, `pq.pauseQueue({ queue })`, and so on.
 *
 * Two reasons that is the better surface, both learned from the version that had chained methods:
 *
 * - **Nothing silently escapes its scope.** `queue.getJob({ jobId })` forwarded to an unscoped read,
 *   so asking one queue's handle for another queue's job returned it — typed as *this* queue's
 *   payload. With one `pq.getJob({ jobId })` there is no scope to be wrong about, and the reads that
 *   genuinely are per-queue take `queue` as a named argument that means exactly what it says.
 * - **One import, one object.** Application code that touches five queues passes five names to one
 *   `pq` instead of threading five handles through its own plumbing.
 *
 * Because of that, holding on to this handle is optional: `pq.addJob({ queue: 'emails', … })` works
 * from a name alone, and a process that only enqueues need not declare the queue at all.
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
