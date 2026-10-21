---
slug: broker-less-database-native-queue
title: Why we built a broker-less, database-native job queue
authors: [gheorghe]
tags: [design]
description: Why PortQueue is a broker-less, database-native job queue using SKIP LOCKED and LISTEN/NOTIFY, so your existing SQL database is all you need.
keywords: [portqueue, broker-less, database queue, postgresql queue, background jobs, transactional enqueue, node.js, job queue]
---

Adding a queue shouldn't mean adding a broker. If you already run PostgreSQL (or SQLite, or
Oracle), you already have durable storage, transactions, and — with `SKIP LOCKED` and
`LISTEN/NOTIFY` — everything a robust queue needs.

<!-- truncate -->

## The hidden cost of a second datastore

A Redis-backed queue is fast, but it's another system to run, secure, monitor, back up,
and keep consistent with your primary database. And the moment you want "enqueue this job
**only if** the order row commits," a separate datastore turns into a distributed-systems
problem — the classic **dual-write bug**.

## When DB-backed wins

- You already operate a relational database and don't want a broker.
- You need **transactional enqueue** — the job and the business write commit together.
- You want jobs to be **queryable with SQL** and visible in a dashboard without a separate
  result backend.
- You ship to customers on **different databases** and want one codebase.

## What we kept broker-like

Low latency still matters, so where the engine supports it (PostgreSQL) workers wake within
milliseconds via `LISTEN/NOTIFY`; elsewhere they poll on a tunable interval. You get
broker-like responsiveness without the broker.

Read how it [scales horizontally](/docs/scale-horizontally), or start with
[Getting Started](/docs/getting-started).
