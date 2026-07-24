---
id: events-vs-hooks
title: Events vs Hooks — when to use which
sidebar_label: Events vs Hooks
description: Choose between PortQueue events and hooks — events observe after the fact, hooks participate before or around an operation to mutate or veto it.
keywords: [portqueue, events, hooks, lifecycle, observability, background jobs, node.js, typescript]
---

# Events vs Hooks — when to use which

They are **not** interchangeable, and one does not replace the other. (A common first
question: *"do we need hooks if we have `on`/`off`?"* — yes.) Pick by a single rule:

> - *"I want to **react after** something happened and I **can't/shouldn't change** it"* → **Event** (`pq.on(...)`).
> - *"I want to run **before/around** an operation and possibly **change or block** it"* → **Hook** (`pq.useHook(...)`).

| | **Events** (`on`/`off`/`once`) | **Hooks** (`useHook`) |
|---|---|---|
| Purpose | Observation | Participation |
| Awaited? | **No** — fan-out is non-blocking | **Yes** — awaited, in registration order |
| Can change the outcome? | **No** — read-only payload | **Yes** — mutate options/data, or **veto by throwing** |
| Inside the caller's transaction? | No | `BEFORE_ADD` does when `tx` is used |
| On the hot path? | Must never block it | Deliberately part of the operation |
| Typical use | metrics, logging, dashboard live view, alerts | inject `metadata`, enforce a tenant `idempotencyKey`, authorize/veto an add, enrich/skip before processing |

Only hooks can do three things an event fundamentally cannot:

1. **Mutate the outgoing job** (`BEFORE_ADD`).
2. **Abort/skip** an operation by throwing (`BEFORE_ADD` / `BEFORE_PROCESS`).
3. **Be awaited**, so the operation waits for them (and runs in the same transaction as the insert).

Rule of thumb restated: **events are past-tense and passive; hooks are present-tense and
active.**

- Full [Events reference](./events.md)
- Full [Hooks reference](./hooks.md)
