/** Capability flags a driver advertises (build_plan/03.1). Core branches on these, never identity. */
export enum DriverCapability {
  LISTEN_NOTIFY = 'LISTEN_NOTIFY',
  SKIP_LOCKED = 'SKIP_LOCKED',
  RETURNING = 'RETURNING',
  DB_GENERATED_UUID = 'DB_GENERATED_UUID',
  TRANSACTIONS = 'TRANSACTIONS',
  ADVISORY_LOCK = 'ADVISORY_LOCK',
  JSON_NATIVE = 'JSON_NATIVE',
  UPSERT = 'UPSERT',
  BATCHED_READ = 'BATCHED_READ',
}

/** A frozen set of capability → boolean (build_plan/03.1). */
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
