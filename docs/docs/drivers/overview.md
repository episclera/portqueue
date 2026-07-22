---
id: overview
title: The driver model
sidebar_label: Overview
---

# The driver model

A **driver** is an adapter that implements the PortQueue `Driver` interface for one
database engine. It owns all SQL and engine-specific behavior; core code branches on
**capabilities**, never on driver identity.

```ts
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

const pq = new PortQueue({ driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }) });
```

Swapping engines is a **one-line import change** — your `addJob` / `createWorker` /
schedule calls are identical across every driver.

## Capabilities

Each driver exposes a `DriverCapabilitySet` describing what the engine supports —
e.g. `LISTEN_NOTIFY`, `SKIP_LOCKED`, `RETURNING`. Where a capability is absent, core
uses a safe fallback (a polling/locking loop instead of `SKIP LOCKED`, polling instead
of `LISTEN/NOTIFY`). Where a capability truly cannot exist, the method still exists and
throws a typed `UnsupportedCapabilityError` explaining the fix — discoverability never
suffers.

## First-party drivers

| Driver | Import | Client peer dep | Best for |
|---|---|---|---|
| [Postgres](./postgres.mdx) | `@portqueue/core/drivers/postgres` | `pg` | Production, multi-instance |
| [PGLite](./pglite.mdx) | `@portqueue/core/drivers/pglite` | `@electric-sql/pglite` | Embedded Postgres, tests |
| [SQLite](./sqlite.mdx) | `@portqueue/core/drivers/sqlite` | `better-sqlite3` | Single-node apps, zero services |
| [Oracle](./oracle.mdx) | `@portqueue/core/drivers/oracle` | `oracledb` | Oracle-shop deployments |

Need another engine? Write a [custom driver](./custom.md) and validate it with the
conformance kit.
