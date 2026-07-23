---
id: scale-horizontally
title: Multi-server / instance
sidebar_label: Multi-server / instance
---

# Multi-server / instance

PortQueue is **instance-agnostic**: it always assumes N copies of your app run at once, and
it never relies on in-process state for the correctness of claiming, scheduling, or dedup.
Scaling out is just "run more instances" — there is **no leader election** and no special
coordinator process. This page covers running many instances safely, then how to steer a
job to a **preferred server** when it needs one.

## Running on multiple instances

Run the **same code on every server** and start as many processes as you need. Every
process is interchangeable: any worker can claim any job, so adding capacity is only a
matter of starting more instances against the same database.

```ts
// identical on every server
const pq = new PortQueue({ driver });
await pq.init();
pq.createWorker({ queue: 'emails', concurrency: 50, handler });
```

Within one worker, `concurrency` bounds how many handlers run at once; across instances,
more processes simply claim more of the backlog in parallel. There is nothing to switch
on — a second instance cooperates with the first the moment it starts.

## Choosing a preferred server with patterns

By default your servers are **anonymous and interchangeable** — any worker claims any job,
which is the right model for stateless work. When a job benefits from **locality** — a warm
cache, a GPU, more RAM, a region — you can describe *what the job needs* as a **pattern** and
let any server matching it pick the job up. This stays safe if those servers disappear, and
it never blocks the ordinary interchangeable path.

It comes together in three moves: **identify** your servers, **encode** their capabilities in
that identity, then **attach a pattern** to the jobs that need a particular class of server.

### Give each server an identity key

An anonymous server runs jobs but can't be targeted. To make a server addressable, give its
process a stable `instanceKey`. A keyed server registers a heartbeat row, honours job affinity,
and can be paused on its own from the dashboard.

```ts
const pq = new PortQueue({
  driver,
  instanceKey: '10.0.1.7:ram-8gb:cpu-4cor', // stable, human-meaningful id for this process
});
```

Run the **same code on every server**; only the key differs per process (derive it from the
environment). Leaving `instanceKey` unset keeps a server anonymous — it still processes jobs
normally, but affinity patterns are rejected there and it never appears in the instances list.

You can type the keys so a typo is a compile-time error — `PortQueue` takes an optional second
type parameter, a union of your instance keys:

```ts
type Instance = `10.0.1.7:ram-8gb:cpu-4cor` | `10.0.2.3:ram-2gb:cpu-1cor`;
const pq = new PortQueue<'emails' | 'reports', Instance>({ driver, instanceKey: '10.0.1.7:ram-8gb:cpu-4cor' });
```

### Encode capabilities in the key

Encode a server's **capabilities**, not just its name — then you target by capability, and
adding or replacing hardware needs no code changes. A good shape packs the identity and the
attributes you might want to target:

```
{container-id-or-ip}:ram-{ram}gb:cpu-{cpu}cor
→ "10.0.1.7:ram-8gb:cpu-4cor", "10.0.2.3:ram-2gb:cpu-1cor"
```

### Attach a pattern to the job

`addJob` accepts a single affinity option, `preferredInstanceKeyPattern` — a regular-expression
**source string** matched against instance keys. Affinity requires the *calling* process to have
an `instanceKey`; passing a pattern from an anonymous process throws.

```ts
// Run this job only on 4 GB or 8 GB servers.
await queue.addJob({ data, preferredInstanceKeyPattern: 'ram-(4|8)gb' });
```

There is **no exact-key pin and no fallback tier** by design: a pattern already spans many
servers, so the first matching server to poll takes the job. Patterns are case-sensitive and
validated when the job is added.

### How a match is decided

At claim time a server may take a job when:

1. the job has **no pattern** (runs anywhere); or
2. the job's pattern **matches this server's key**.

If no live server matches, the job simply **waits** until one does — nothing runs it "by
accident". Prefer broad, capability-based patterns (`ram-(4|8)gb`) over narrow host pins so work
is never stranded when a single server goes away.

> Because affinity uses regexes and the schema is index-free, the claim path evaluates affinity
> **in the tool**, not in SQL. It pages through candidates highest-priority-first and keeps only the
> ones this server matches, stopping when the batch is full or the backlog is exhausted — so a
> server is never starved by a burst of jobs meant for others. Over LISTEN/NOTIFY, a wakeup for a
> job whose pattern can't match this server is skipped outright.

### Replacing a server without stranding work

Because affinity is a **pattern**, not a host pin, replacing a server is usually a no-op: start a
new process whose key matches the same pattern (e.g. another `…:ram-8gb:…` box) and it picks up the
pending work automatically. This is why you should **build meaningful, scalable patterns from the
start** — target *what the job needs*, not *which machine*.

If you did pin work to a now-gone class of servers with a narrow pattern, reroute it by widening the
`preferred_instance_key_pattern` on the still-pending job rows to match the replacements; matching
servers then claim them on the next poll.

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
- **Visibility timeout** — a claim is invisible to others for `lockDurationMs`, refreshed
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
