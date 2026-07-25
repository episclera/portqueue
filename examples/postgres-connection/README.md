# Real Postgres connection

The other examples use embedded PGLite; this one connects to a **real Postgres server** via
`PostgresDriver` and a `DATABASE_URL`. It's the closest to how you'd ship in production.

## Prerequisites

- The `pg` peer dependency (declared in this example's `package.json`).
- A reachable Postgres database that **already exists** — PortQueue creates only its own tables.

```bash
# point at your database (the DB must already exist)
DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:postgres

# or, from this folder:
DATABASE_URL=postgres://user:pass@localhost:5432/app npm start
```

If `DATABASE_URL` is unset it defaults to `postgresql://portqueue:portqueue@localhost:5432/portqueue`,
which matches the repo's dev Postgres — so from a clean checkout you can just:

```bash
npm run db:pg:up          # start the dev Postgres in Docker
npm run example:postgres
```

