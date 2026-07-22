# Dev scripts

Local development helpers. All scripts resolve the repo root themselves, so you can run
them from anywhere.

## CLI (`scripts/cli/`)

Run the CLI locally against a throwaway PGLite database (no external DB needed):

```bash
scripts/cli/run.sh queues
scripts/cli/run.sh add --queue emails --data '{"to":"a@b.com"}'
scripts/cli/run.sh jobs --queue emails
```

`run.sh` builds `@portqueue/core` and `@portqueue/cli` on first use and injects the bundled
`scripts/cli/portqueue.config.mjs` unless you pass your own `--config`.

## Dev services (`scripts/dev/`)

| Script | What it does |
|---|---|
| `dev/start-docs.sh` | Start the Docusaurus site at http://localhost:3000 |
| `dev/start-postgres.sh` / `dev/stop-postgres.sh` | Start/stop Postgres 16 on `localhost:5432` |
| `dev/start-oracle.sh` / `dev/stop-oracle.sh` | Start/stop Oracle (gvenzl/oracle-free) on `localhost:1521` |

The database services are defined in [`.docker/docker-compose.yml`](../.docker/docker-compose.yml)
and start independently. Credentials are dev-only (`portqueue` / `portqueue`).

These are also exposed as root npm scripts — `npm run dev:docs`, `npm run db:pg:up`,
`npm run db:pg:down`, `npm run db:oracle:up`, `npm run db:oracle:down`, and `npm run cli -- <args>`.
