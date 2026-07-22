---
id: introduction
title: Introduction
slug: /introduction
sidebar_position: 1
---

# PortQueue

**PortQueue is a database-backed job queue for Node.js.** It treats your relational
database as the single source of truth and works across multiple engines through a
driver abstraction — with first-class drivers for **Postgres, Oracle, PGLite, and
SQLite**, plus a custom-driver interface for anything else.

It is for teams who already run a relational database and don't want to add Redis (or
any other broker) just to get a reliable queue. It takes the best ergonomics from
[pg-boss](https://github.com/timgit/pg-boss) and [BullMQ](https://docs.bullmq.io) and
the operational maturity of [Celery](https://docs.celeryq.dev), and improves on all
three.

## License {#license}

**Free and open source. Commercial use permitted. No license fee, no obligations.** (MIT)

## When to use it

- A backend that needs **background jobs** (emails, webhooks, image processing) without standing up a broker.
- A **horizontally scaled** service on many instances that must cooperate on one queue without double-processing.
- A team that wants **transactional enqueue** — a job is queued only if the surrounding DB transaction commits.
- Teams that want a **dashboard + CLI** without wiring a third-party service.
- Products that must run on a **customer-chosen database** (Postgres here, Oracle there) from one codebase.

## Why choose PortQueue

| | PortQueue | pg-boss | BullMQ | Celery |
|---|---|---|---|---|
| Storage | Any SQL engine (driver) | Postgres only | Redis | Redis/RabbitMQ + result backend |
| Broker required | No | No | Yes (Redis) | Yes |
| Transactional enqueue | Yes (your tx) | Limited | No | No |
| Multi-step resumable jobs | Yes (each step a row) | No | Flows (Redis) | Chains/canvas |
| Strict types + enums | Yes, end to end | Partial | Partial | N/A (Python) |
| Named options everywhere | Yes | Mixed positional | Mixed positional | N/A |

### What we took, and where we improved

- **From pg-boss:** the insight that a relational DB with `SKIP LOCKED` + `LISTEN/NOTIFY`
  is enough — no broker. We go **multi-driver**, strict named-options, and richer result objects.
- **From BullMQ:** the clean **producer/consumer split** (`Queue` produces, `Worker` consumes).
  We drop fragile numeric progress in favor of **resumable multi-step workflows**.
- **From Celery:** retries with backoff, rate limits, visibility timeouts, and *acks-late*.
  We add strict typing end to end and keep results in the same database — no separate result backend.

Read on in [Getting Started](./getting-started/installation.mdx).
