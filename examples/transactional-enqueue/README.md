# Transactional enqueue

Enqueue a job **atomically with your own database write**, so a job and the row it depends on
commit (or roll back) together. The core pattern:

1. open a transaction on your own `pg` client,
2. do your business write,
3. `addJob({ tx })` on the **same** transaction (wrap the client with `fromPg`),
4. commit.

If anything fails before commit, both the business row and the job insert roll back. Because the
job is inserted inside your transaction, workers only see it **after** you commit — on Postgres the
driver `NOTIFY`s at commit for instant pickup; engines without LISTEN/NOTIFY pick it up on the next
poll.

## Prerequisites

- The `pg` peer dependency (declared in this example's `package.json`).
- A reachable Postgres database that **already exists**.

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/app npm run example:transactional
# or, from this folder:
DATABASE_URL=postgres://user:pass@localhost:5432/app npm start
```

If `DATABASE_URL` is unset it defaults to `postgres://postgres:postgres@localhost:5432/portqueue_examples`.
