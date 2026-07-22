---
slug: portqueue-vs-pgboss-bullmq-celery
title: PortQueue vs pg-boss vs BullMQ vs Celery
authors: [gheorghe]
tags: [comparison]
---

An honest look at where each of these shines — and where PortQueue's multi-driver,
strictly-typed, transactional design matters.

<!-- truncate -->

| | PortQueue | pg-boss | BullMQ | Celery |
|---|---|---|---|---|
| Storage | Any SQL engine (driver) | Postgres only | Redis | Redis/RabbitMQ + result backend |
| Broker required | No | No | Yes | Yes |
| Transactional enqueue | Yes (your tx) | Limited | No | No |
| Resumable multi-step | Yes (each step a row) | No | Flows (Redis) | Chains/canvas |
| Strict typing | End to end | Partial | Partial | N/A |
| Named options | Everywhere | Mixed positional | Mixed positional | N/A |

## Where each shines

- **pg-boss** — a great, focused Postgres queue. If you're Postgres-only and happy with
  its API, it's excellent. PortQueue generalizes the idea to many engines with strict
  named options and richer results.
- **BullMQ** — the gold standard on Redis, with a clean producer/consumer split we
  admire and adopted. If Redis is already core to your stack, it's a strong choice.
  PortQueue trades Redis for your existing database and swaps numeric progress for
  resumable steps.
- **Celery** — battle-tested operational maturity in the Python world (retries, rate
  limits, beat, visibility timeouts). PortQueue brings that maturity to typed Node.js
  and keeps results in the same database.

## Why the differences matter

If you want **transactional enqueue** or must run on a **customer-chosen database**, the
broker-based options can't help cleanly. That's the gap PortQueue fills.

See the full [Introduction](/docs/introduction) for the rationale.
