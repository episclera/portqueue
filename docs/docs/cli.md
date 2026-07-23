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
or an explicit `--config` path. The config module exports the same `PortQueue` options
your app uses, so the CLI, dashboard, and app all agree on driver, schema, and queues.

## Docker

Run the CLI in a container for one-off ops or to host the dashboard: mount your config
module, pass `--config`, and expose the dashboard `--port`. Because everything is driven
by the shared config, no app changes are needed.

```dockerfile title="Dockerfile"
FROM node:20-alpine
WORKDIR /app

# Install the CLI plus the client for your driver — it's an optional peer dependency,
# so pick the one you use: pg (Postgres/Citus/Yugabyte), mysql2, oracledb, …
RUN npm install -g @portqueue/cli pg

# The config module is mounted at runtime (see `docker run` below), so nothing
# app-specific is baked into the image.
EXPOSE 9000
ENTRYPOINT ["portqueue"]
# Default to serving the dashboard; override the command for one-off ops.
CMD ["dashboard", "--config", "/config/portqueue.config.mjs", "--port", "9000"]
```

```bash
# Build the image once.
docker build -t portqueue-cli .

# Host the dashboard: mount your config, publish the port.
docker run --rm -p 9000:9000 \
  -v "$(pwd)/portqueue.config.mjs:/config/portqueue.config.mjs:ro" \
  portqueue-cli

# One-off op: override the default command (the ENTRYPOINT stays `portqueue`).
docker run --rm \
  -v "$(pwd)/portqueue.config.mjs:/config/portqueue.config.mjs:ro" \
  portqueue-cli migrate --config /config/portqueue.config.mjs
```

:::note
The CLI ships no TypeScript compiler, so point `--config` at a prebuilt `.js`/`.mjs`
module (as above). To load a `.ts` config directly, run it under a loader instead — e.g.
`node --import tsx node_modules/@portqueue/cli/dist/cli.mjs …`.
:::

