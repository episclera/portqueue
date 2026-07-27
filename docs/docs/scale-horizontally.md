---
id: scale-horizontally
title: Multi-server / instance
sidebar_label: Multi-server / instance
description: Scale PortQueue horizontally across many servers with no leader election — instance keys, RegEx affinity patterns, and the mechanics that prevent double-processing.
keywords: [portqueue, horizontal scaling, multi-instance, scaling, job queue, node.js, production, database queue]
---

# Multi-server / instance

PortQueue scales out by running more copies of your app — that's the whole model. There is
**no leader election** and no coordinator process, and nothing about claiming, scheduling, or
dedup depends on in-process state. It always assumes N instances run at once.

This page covers running many instances safely, then how to steer a job to a **preferred
server** when it needs one.

## Running on multiple instances

Run the **same code on every server** and start as many processes as you need — that's all
it takes to add capacity. Every process is interchangeable: any worker can claim any job.

## Choosing a preferred server with RegEx patterns

Most work is stateless and should run anywhere — that's the default, and it's the right one.
When a job instead benefits from **locality** (a warm cache, a GPU, more RAM, a region),
describe *what the job needs* as a **RegEx pattern** and let any server matching it claim the
job. This stays safe if those servers disappear and never blocks the ordinary interchangeable
path.

Three moves get you there: **identify** your servers, **encode** their capabilities in that
identity, then **attach a RegEx pattern** to the jobs that need a particular class of server.

### Give each server an identity key

To make a server targetable, give its process a stable `instance.instanceKey`. A keyed server registers
a heartbeat row, honours job affinity, and can be paused on its own from the dashboard; an
anonymous one runs jobs but can't be addressed.

Each heartbeat also records the **CPU and memory of that server's Node process** — CPU as a share of
the cores available to it, heap as a share of the limit V8 would abort at — so the instances list and
the `portqueue instances` command show how every process is doing at the moment it was last heard
from.
They are deliberately not host-wide numbers: two instances on one machine report their own figures,
and a host memory reading would count memory the OS merely allocated elsewhere. That happens for any
keyed instance — it does not require a
[`systemLimiter`](./guides/rate-limiting.md#system-pressure-backpressure), which only decides whether
those numbers also pause claiming.

```ts
const pq = new PortQueue({
  driver,
  instance: { instanceKey: '10.0.1.7:ram-8gb:cpu-4cor' }, // stable, human-meaningful name for this process
});
```

Run the **same code on every server**; only the key differs per process (derive it from the
environment). Set a key from day one — **even on a single machine** — so adding a second server later
changes nothing but the environment. Leaving `instance.instanceKey` unset keeps a server anonymous:
it still processes jobs normally, but affinity patterns are rejected there and it never appears in
the instances list.

### Encode capabilities in the key

Encode a server's **capabilities**, not just its name — then you target by capability and
swapping hardware needs no code changes. A good shape packs the identity and the attributes
you might want to target:

```
{container-id-or-ip}:ram-{ram}gb:cpu-{cpu}cor
→ "10.0.1.7:ram-8gb:cpu-4cor", "10.0.2.3:ram-2gb:cpu-1cor"
```

### Attach a RegEx pattern to the job

`addJob` accepts a single affinity option, `preferredInstanceKeyPattern` — a regular-expression
**source string** matched against instance keys. Affinity requires the *calling* process to have
an `instance.instanceKey`; passing a pattern from an anonymous process throws.

```ts
// Runs only on the 8 GB servers.
await queue.addJob({ data, preferredInstanceKeyPattern: 'ram-8gb' });

// Runs only on 8 GB servers that also have 4 cores — '.*' skips whatever sits between the tags.
await queue.addJob({ data, preferredInstanceKeyPattern: 'ram-8gb.*cpu-4cor' });
```

The pattern is matched **unanchored** — a plain "the key contains this" test — and is
case-sensitive, so a distinctive capability tag is usually the whole pattern you need. Add `^`/`$`
when you want to match a key exactly, and `.*` ("anything") to require two tags in the same key.

There is **no exact-key pin and no fallback tier** by design: a RegEx pattern already spans many
servers, so the first matching server to poll takes the job. Patterns are validated (compiled) when
the job is added.

### How a match is decided

At claim time a server may take a job when:

1. the job has **no pattern** (runs anywhere); or
2. the job's pattern **matches this server's key**.

If no live server matches, the job simply **waits** until one does — nothing runs it "by
accident". Prefer broad, capability-based RegEx patterns (`ram-8gb`) over narrow host pins so
work is never stranded when a single server goes away.

> Because affinity uses regexes and the schema is index-free, the claim path evaluates affinity
> **in the tool**, not in SQL. It pages through candidates highest-priority-first and keeps only the
> ones this server matches, stopping when the batch is full or the backlog is exhausted — so a
> server is never starved by a burst of jobs meant for others. Over LISTEN/NOTIFY, a wakeup for a
> job whose pattern can't match this server is skipped outright.

### Replacing a server without stranding work

Because affinity is a **RegEx pattern**, not a host pin, replacing a server is usually a no-op: start a
new process whose key matches the same pattern (e.g. another `…:ram-8gb:…` box) and it picks up the
pending work automatically. This is why you should **build meaningful, scalable RegEx patterns from the
start** — target *what the job needs*, not *which machine*.

If you did pin work to a now-gone class of servers with a narrow RegEx pattern, reroute it by widening the
`preferred_instance_key_pattern` on the still-pending job rows to match the replacements; matching
servers then claim them on the next poll.

:::warning No API to re-pattern already-enqueued jobs — this is raw SQL
`preferredInstanceKeyPattern` is set once, when the job is added; there is **no PortQueue method to
change it on jobs that are already pending**. Rerouting them means running raw SQL directly against
the jobs table — an `UPDATE` that overwrites the `preferred_instance_key_pattern` column on the rows
that haven't run yet (e.g. `UPDATE <jobs table> SET preferred_instance_key_pattern = '<new pattern>'
WHERE preferred_instance_key_pattern = '<old pattern>' AND status IN ('PENDING', 'RETRY')`). Status
values are stored uppercase; only touch not-yet-run rows, and make sure the new value is a valid regex
source string, since PortQueue no longer validates it on this path.
:::

## Operating individual servers

### Pausing a single server

An identified server can stop processing without stopping the others. This is persisted, so it
survives restarts and can be driven from the dashboard:

```ts
await pq.pauseInstance({ instanceKey: '10.0.1.7:ram-8gb:cpu-4cor' });
await pq.resumeInstance({ instanceKey: '10.0.1.7:ram-8gb:cpu-4cor' });
```

A paused server keeps heartbeating (so it still shows as alive) but claims no jobs until resumed.

### Removing a server from monitoring

When a server is decommissioned its instance row lingers in the instances list. You can remove that
row once the server has been **inactive for at least 30 minutes** (a live or recently-seen server
would just re-register on its next heartbeat, so removal is refused until then).

This is safe: jobs record the processing server as a plain string (`processed_on_instance_key`),
never a foreign key to the instances table, so removing an instance row **never touches or orphans
any job** — it only tidies the list. The tool never removes instances on its own.

```ts
await pq.removeInstance({ instanceKey: '10.0.9.9:ram-2gb:cpu-1cor' }); // throws if seen < 30 min ago
```

- **Dashboard** → **Instances**: a **Remove** action appears on any server last seen over 30
  minutes ago.
- **CLI**: `portqueue remove-instance --instance-key <key>`.

### Observing attribution

Each processed job records the server that ran it in `processedOnInstanceKey`
(`JobSnapshot.processedOnInstanceKey`), and `pq.getInstances()` returns liveness plus per-server
counts for your own dashboards. `INSTANCE_PAUSED` / `INSTANCE_RESUMED` / `INSTANCE_REMOVED` are
emitted as events and streamed live to the dashboard.

## What keeps concurrent instances safe

You rarely need to think about this — it's on by default — but for the curious, a handful of
mechanisms let many instances share one database with no double-processing and no lock contention:

- **`SKIP LOCKED`** (where available) lets many instances claim different rows
  simultaneously without contention or double-processing. Engines without it use a safe
  locking/polling fallback.
- **Per-queue claim loops** — each queue has its own `queue_name`-scoped claim loop, so a
  job never waits on another queue and busy `orders` traffic can't starve `emails`.
- **Visibility timeout** — a claim is invisible to others for `lockDurationSeconds`, refreshed
  by an automatic heartbeat. If an instance dies, the lock lapses and the job becomes
  `STALLED` and reclaimable by another instance.
- **Cluster-coordinated scheduling & retention** — schedule ticks and retention are
  coordinated so exactly one instance produces a given scheduled run.
- **Connection-pool caveat** — many instances sharing one database still share its
  connection budget. Size pools for the sum of worker concurrencies plus headroom; for
  strict isolation, run critical vs bulk workloads as **separate `PortQueue` instances /
  pools** so one can't exhaust the other's connections.

See [Going to Production](./production.md) for the operational defaults, and
[Rate limiting & backpressure](./guides/rate-limiting.md) for throttling.
