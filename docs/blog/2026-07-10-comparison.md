---
slug: portqueue-vs-pgboss-bullmq-celery
title: PortQueue vs pg-boss vs BullMQ vs Celery
authors: [gheorghe]
tags: [comparison]
description: PortQueue vs pg-boss, BullMQ, and Celery — a multi-driver, distributed, transactional job queue that runs on any SQL engine with no broker.
keywords: [portqueue, bullmq alternative, pg-boss alternative, celery alternative, job queue, database queue, broker-less, node.js]
---

An honest look at where each of these shines — and where PortQueue's multi-driver,
distributed-by-design, transactional approach matters.

<!-- truncate -->

| | PortQueue | pg-boss | BullMQ | Celery |
|---|---|---|---|---|
| Storage | Any SQL engine (7 drivers) | Postgres only | Redis | Redis/RabbitMQ + result backend |
| Broker required | No | No | Yes | Yes |
| Same code, any engine | Yes — swap the driver | Postgres only | Redis only | Broker only |
| Distributed instances | Yes (`SKIP LOCKED`, opt-in keys) | Yes | Yes | Yes |
| Transactional enqueue | Yes (your tx) | Limited | No | No |
| Resumable multi-step | Yes (each step a row) | No | Flows (Redis) | Chains/canvas |
| Fault tolerance | Timeouts, retries, stall recovery | Retries | Retries, stalled checks | Retries, acks-late |
| Local testing | In-process PGLite / SQLite | Needs Postgres | Needs Redis | Needs broker |
| Strict typing | End to end | Partial | Partial | N/A |

## What makes PortQueue different

- **Great for distributed instances.** Any number of workers, on any number of servers,
  claim from the same queue with `SKIP LOCKED` and never double-process. Multi-instance
  mode is a one-line opt-in.
- **Truly multi-driver — same code, different engines.** The same application code runs
  unchanged on Postgres, MySQL, Oracle, PGLite, and SQLite. You swap the
  driver, not your code.
- **Easy to test.** Run your entire suite in-process against PGLite or SQLite — no Redis,
  no broker, no external database to stand up.
- **Fault tolerant.** Visibility timeouts, retries with backoff, and stalled-job recovery
  mean an instance can crash mid-job without losing work.

## Where each shines

- **pg-boss** — a great, focused Postgres queue. If you're Postgres-only and happy with
  its API, it's excellent. PortQueue generalizes the idea to many engines — the same code
  runs on seven of them — with richer results and in-process testing.
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

See [Getting Started](/docs/getting-started/installation) to try it.
