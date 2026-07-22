---
id: cli
title: CLI
sidebar_label: CLI
---

# CLI

`@portqueue/cli` operates a PortQueue from the terminal. It auto-discovers your config
module (`./portqueue.config.ts`) so it connects to the same database as your app.

## Common commands

```bash
# live stats, refreshing
portqueue stats --watch

# tail the event feed for one queue (runs until interrupted)
portqueue listen --queue orders

# retry a failed job
portqueue retry --id <jobId> --yes

# serve the dashboard (see the Dashboard page)
portqueue dashboard --config ./portqueue.config.ts --port 9000 \
  --root-user admin --root-password ****

# run migrations as a separate deploy step
portqueue migrate --config ./portqueue.config.ts
```

## Config discovery

Most commands load your configured client from `./portqueue.config.ts` (auto-discovered)
or an explicit `--config` path. The config module exports the same `PortQueue` options
your app uses, so the CLI, dashboard, and app all agree on driver, schema, and queues.

## Docker

Run the CLI in a container for one-off ops or to host the dashboard: mount your config
module, pass `--config`, and expose the dashboard `--port`. Because everything is driven
by the shared config, no app changes are needed.

:::tip Migrations in production
Prefer running `portqueue migrate` as a **separate, single deploy step** before rolling
app instances, with the client in `MigrationMode.MANUAL`/`VALIDATE_ONLY`. See
[Production](./production.md).
:::
