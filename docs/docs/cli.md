---
id: cli
title: CLI
sidebar_label: CLI
---

# CLI

`@portqueue/cli` operates a PortQueue from the terminal. It auto-discovers your config
module (`./portqueue.config.ts`) so it connects to the same database as your app.

## The config module

The CLI never builds its own instance from a connection string — it imports **exactly the
`PortQueue` your app configures**, so the CLI, dashboard, and app always agree on driver,
schema, and queues. Create a `portqueue.config.{ts,js,mjs,cjs}` that **default-exports** a
`PortQueue` (or a factory that returns one):

```ts title="portqueue.config.ts"
import { PortQueue } from '@portqueue/core';
import { PostgresDriver } from '@portqueue/core/drivers/postgres';

// Default-export a configured PortQueue instance…
export default new PortQueue({
  driver: new PostgresDriver({ connectionString: process.env.DATABASE_URL }),
});

// …or export a factory (sync or async) — the CLI will call it:
//   export default () => new PortQueue({ driver: new PostgresDriver({ ... }) });
```

The CLI discovers this file by walking up from the current directory; override the location
with `--config <path>` and the export name with `--export <name>` (defaults to `default`).

:::note
The CLI ships no TypeScript compiler, so point it at a prebuilt `.js`/`.mjs` module. To load
a `.ts` config directly, run the CLI under a loader instead — e.g.
`node --import tsx node_modules/@portqueue/cli/dist/cli.mjs …`.
:::

## Common commands

```bash
# live stats, refreshing
portqueue stats --watch

# tail the event feed for one queue (runs until interrupted)
portqueue listen --queue orders

# retry a failed job
portqueue retry --id <jobId> --yes

# remove a long-inactive instance (refused unless unseen for 30+ min)
portqueue remove-instance --instance-key 10.0.9.9:ram-2gb:cpu-1cor

# remove an unused queue (refused if this process still declares it)
portqueue remove-queue --queue legacy-emails

# serve the dashboard (see the Dashboard page)
portqueue dashboard --config ./portqueue.config.ts --port 9000 \
  --root-user admin --root-password ****

# run migrations as a separate deploy step
portqueue migrate --config ./portqueue.config.ts
```

## Config discovery

Most commands load your configured client from `./portqueue.config.ts` (auto-discovered)
or an explicit `--config` path — the same `PortQueue` your app uses, so the CLI, dashboard,
and app all agree on driver, schema, and queues. See
[The config module](#the-config-module) above. To run the CLI-hosted dashboard in a
container, see [Dashboard → Docker](./dashboard.mdx#docker).

