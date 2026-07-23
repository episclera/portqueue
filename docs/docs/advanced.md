---
id: advanced
title: Advanced
sidebar_label: Advanced
---

# Advanced

Lower-level extension points for when the built-in engines aren't enough. Today that means
teaching PortQueue about a **new database engine** by writing your own driver.

## Writing a custom driver

Any engine PortQueue doesn't ship first-party can be supported by implementing the
`Driver` interface and declaring which **capabilities** it supports. Core branches on
capabilities, so an honest capability set is all it needs — every correctness invariant
(name uniqueness, idempotency/singleton dedup, transactional enqueue) is enforced in core,
so your driver only has to emit the best SQL its engine can.

```ts
import type { Driver, DriverProbe, Subscription, MigrationStep } from '@portqueue/core';
import { capabilities, DriverCapability } from '@portqueue/core';

class MyDriver implements Driver {
  readonly capabilities = capabilities({
    [DriverCapability.SKIP_LOCKED]: false,   // no row-skip lock? core uses a safe fallback
    [DriverCapability.LISTEN_NOTIFY]: false, // no pub/sub? core polls
    [DriverCapability.RETURNING]: false,
  });

  async connect(): Promise<void> { /* open your client */ }
  async probe(): Promise<DriverProbe> { /* lightweight health/version check */ }
  async migrate(steps: MigrationStep[]): Promise<void> { /* apply schema */ }
  // …query / claim / complete / notify methods per the Driver interface
}

const pq = new PortQueue({ driver: new MyDriver() });
```

### Own your dialect and migrations

A driver is **fully standalone**: it lives in its own folder, carries its own migrations
authored in its engine's dialect, and shares no query-building code with other drivers —
even wire-compatible ones. Core calls intent-named methods (`upsert`, `getOrCreate`, …) and
your driver emits whatever its engine does best: native `INSERT … ON CONFLICT` on a capable
engine, a guarded `UPDATE … RETURNING`-then-`INSERT` on a sharded one, or a mutate-then-read
on an engine without `RETURNING`. All values are bound parameters; identifiers are
allowlist-validated and quoted; every operation runs in a transaction.

### Declare capabilities honestly

- `SKIP_LOCKED` — can you claim rows without blocking on locked ones? If not, core uses a
  polling/locking fallback.
- `LISTEN_NOTIFY` — do you have cross-connection pub/sub? If not, core polls at
  `pollIntervalMs`.
- `RETURNING` — can `INSERT`/`UPDATE` return the affected row in one round-trip?

Where a feature genuinely can't exist, the corresponding method still exists and throws a
typed `UnsupportedCapabilityError` telling the developer the right path.

### Validate with the conformance kit

The kit runs the full behavioral suite against your driver so you know it obeys the same
contract as the first-party ones.

```ts
import { runConformance } from '@portqueue/core/conformance';

await runConformance({ makeDriver: () => new MyDriver() });
```

The same kit validates the built-in drivers, so passing it means your engine behaves
identically to Postgres/SQLite from app code's perspective.
