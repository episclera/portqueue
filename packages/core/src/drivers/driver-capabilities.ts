/**
 * Capability flags a driver advertises. Core branches on these, never identity — and every flag
 * here is read somewhere. A flag nothing branches on is a promise nothing keeps, so it does not
 * exist.
 */
export enum DriverCapability {
  /** The engine can push notifications, so a producer wakes a consumer without waiting on a poll. */
  LISTEN_NOTIFY = 'LISTEN_NOTIFY',
  /** `FOR UPDATE SKIP LOCKED`, so concurrent claimers never contend on the same rows. */
  SKIP_LOCKED = 'SKIP_LOCKED',
  /** DML can return the rows it changed, so a mutate-and-read is one statement rather than two. */
  RETURNING = 'RETURNING',
  /** Statements can be grouped in a transaction (a driver without this no-ops the wrapper). */
  TRANSACTIONS = 'TRANSACTIONS',
  /** Cross-connection advisory locks, used to elect a single migrator. */
  ADVISORY_LOCK = 'ADVISORY_LOCK',
}

/** A frozen set of capability → boolean. */
export type DriverCapabilitySet = Readonly<Record<DriverCapability, boolean>>;

/** Build a full capability set from a partial (missing flags default to false). */
export function capabilities(
  partial: Partial<Record<DriverCapability, boolean>>,
): DriverCapabilitySet {
  const full = {} as Record<DriverCapability, boolean>;
  for (const cap of Object.values(DriverCapability)) {
    full[cap] = partial[cap] ?? false;
  }
  return Object.freeze(full);
}
