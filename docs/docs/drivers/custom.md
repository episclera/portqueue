---
id: custom
title: Writing a custom driver
sidebar_label: Custom driver
---

# Writing a custom driver

Any engine PortQueue doesn't ship first-party can be supported by implementing the
`Driver` interface and declaring which **capabilities** it supports. Core branches on
capabilities, so an honest capability set is all it needs.

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

## Declare capabilities honestly

- `SKIP_LOCKED` — can you claim rows without blocking on locked ones? If not, core uses a
  polling/locking fallback.
- `LISTEN_NOTIFY` — do you have cross-connection pub/sub? If not, core polls at
  `pollIntervalMs`.
- `RETURNING` — can `INSERT`/`UPDATE` return the affected row in one round-trip?

Where a feature genuinely can't exist, the corresponding method still exists and throws
a typed `UnsupportedCapabilityError` telling the developer the right path.

## Validate with the conformance kit

The kit runs the full behavioral suite against your driver so you know it obeys the same
contract as the first-party ones.

```ts
import { runConformance } from '@portqueue/core/conformance';

await runConformance({ makeDriver: () => new MyDriver() });
```

The same kit validates the built-in drivers, so passing it means your engine behaves
identically to Postgres/SQLite from app code's perspective.
