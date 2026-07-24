---
id: introduction
title: Introduction
slug: /introduction
sidebar_position: 1
---

# PortQueue

**PortQueue is a database-backed job queue for Node.js.** It treats your relational
database as the single source of truth and works across multiple engines through a
driver abstraction — with first-class drivers for **Postgres, MySQL, Oracle, PGLite, and
SQLite**, plus a custom-driver interface for anything else.

It is for teams who already run a relational database and don't want to add Redis (or
any other broker) just to get a reliable queue. It takes the best ergonomics from
[pg-boss](https://github.com/timgit/pg-boss) and [BullMQ](https://docs.bullmq.io) and
the operational maturity of [Celery](https://docs.celeryq.dev), and improves on all
three.

## The model

PortQueue has exactly three objects, so "produce here, process there" is a first-class
deployment shape:

- **`PortQueue`** — the client. One per database; owns the connection, migrations, and
  shared services. Construction is DI-only (no I/O); `init()` connects and migrates.
- **`Queue`** — the **producer** handle for one named queue: add, schedule, inspect, and
  control jobs. See [Producing jobs](./guides/producing-jobs.mdx).
- **`Worker`** — the **consumer** for one queue: claims jobs and runs handlers. Created
  separately, so producing and consuming can live on different servers. See
  [Consuming jobs](./guides/consuming-jobs.md).

The only difference between a simple queue and a **workflow** queue is the consumer: a
simple worker has one `handler`; a [workflow](./workflows/what-is-a-workflow.md) worker
has many `steps`. Producing is the same `addJob({ data })` in both.

## When to use it

- A backend that needs **background jobs** (emails, webhooks, image processing) without standing up a broker.
- A **horizontally scaled** service on many instances that must cooperate on one queue without double-processing.
- A team that wants **transactional enqueue** — a job is queued only if the surrounding DB transaction commits.
- Teams that want a **dashboard + CLI** without wiring a third-party service.
- Products that must run on a **customer-chosen database** (Postgres here, Oracle there) from one codebase.

## Why choose PortQueue

| | PortQueue | pg-boss | BullMQ | Celery |
|---|---|---|---|---|
| Storage | Any SQL engine (5 drivers) | Postgres only | Redis | Redis/RabbitMQ + result backend |
| Broker required | No | No | Yes (Redis) | Yes |
| Same code, any engine | Yes — swap the driver | Postgres only | Redis only | Broker only |
| Distributed instances | Yes (`SKIP LOCKED`, opt-in instance keys) | Yes | Yes | Yes |
| Preferred-server routing | Yes — pin a job to a server by RegEx pattern | No | No | Via routing keys |
| Transactional enqueue | Yes (your tx) | Limited | No | No |
| Multi-step resumable jobs | Yes (each step a row) | No | Flows (Redis) | Chains/canvas |
| Fault tolerance | Visibility timeouts, retries + backoff, stall recovery | Retries | Retries, stalled checks | Retries, acks-late |
| Local testing | In-process PGLite / SQLite — no service | Needs Postgres | Needs Redis | Needs broker |
| Strict types + enums | Yes, end to end | Partial | Partial | N/A (Python) |

PortQueue is built for teams running **many cooperating instances**: workers on any number
of servers claim jobs from the same queue with `SKIP LOCKED` and never double-process, and
multi-instance mode is a simple opt-in. Because every engine sits behind the same driver
contract, the **same application code runs unchanged** on Postgres, MySQL, Oracle, PGLite,
or SQLite — you swap the driver, not your code. That also makes it
**trivial to test**: run your whole suite in-process against PGLite or SQLite with no
external service to stand up. And it's **fault tolerant** by design — visibility timeouts,
retries with backoff, and stalled-job recovery mean an instance can crash mid-job without
losing work.

### What we took, and where we improved

- **From pg-boss:** the insight that a relational DB with `SKIP LOCKED` + `LISTEN/NOTIFY`
  is enough — no broker. We go **multi-driver** (the same code across seven engines),
  **testable in-process** with PGLite/SQLite, and add richer result objects.
- **From BullMQ:** the clean **producer/consumer split** (`Queue` produces, `Worker` consumes).
  We drop fragile numeric progress in favor of **resumable multi-step workflows**.
- **From Celery:** retries with backoff, rate limits, visibility timeouts, and *acks-late*.
  We add strict typing end to end and keep results in the same database — no separate result backend.

Read on in [Getting Started](./getting-started/installation.mdx).

## License {#license}

**Free and open source. Commercial use permitted. No license fee, no obligations.** (MIT)
