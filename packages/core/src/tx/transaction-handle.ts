/**
 * The result of running a statement on a {@link TransactionHandle}.
 * `rows` is present for statements that return rows (RETURNING / SELECT).
 */
export interface TxQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

/**
 * An opaque handle wrapping the developer's *own* native transaction/connection
 *. Produced by an adapter (`fromKnex`, `fromPg`, …). PortQueue runs
 * its parameterized INSERT/UPDATE statements on it and **never** begins, commits, or
 * rolls back — the developer owns that boundary.
 */
export interface TransactionHandle {
  /** Brand so `tx` is unmistakably a PortQueue transaction handle. */
  readonly __portqueueTx: true;
  /** Which engine's SQL dialect this handle expects, so the driver can guard. */
  readonly engine?: string;
  /** Run a parameterized statement on the caller's transaction. */
  execute(sql: string, params: readonly unknown[]): Promise<TxQueryResult>;
  /**
   * Register a callback to fire after the caller commits, used to defer NOTIFY
   *. Optional — when absent, the safety poll backstops the notify.
   */
  onCommit?(callback: () => void): void;
}

/** Type guard for a transaction handle. */
export function isTransactionHandle(value: unknown): value is TransactionHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __portqueueTx?: unknown }).__portqueueTx === true
  );
}
