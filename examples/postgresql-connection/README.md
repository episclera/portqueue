# Real PostgreSQL connection

The other examples use embedded PGLite; this one connects to a **real PostgreSQL server** via
`PostgresqlDriver` and a `DATABASE_URL`. It's the closest to how you'd ship in production.

## Prerequisites

- The `pg` peer dependency (declared in this example's `package.json`).
- A reachable PostgreSQL database that **already exists** — PortQueue creates only its own tables.

```bash
# point at your database (the DB must already exist)
DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:postgresql

# or, from this folder:
DATABASE_URL=postgres://user:pass@localhost:5432/app npm start
```

If `DATABASE_URL` is unset it defaults to `postgresql://portqueue:portqueue@localhost:5432/portqueue`,
which matches the repo's dev PostgreSQL — so from a clean checkout you can just:

```bash
npm run db:postgresql:up          # start the dev PostgreSQL in Docker
npm run example:postgresql
```

