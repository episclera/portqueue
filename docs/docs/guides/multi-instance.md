---
id: multi-instance
title: Multi-server & multi-instance
sidebar_label: Multi-server / instance
---

# Multi-server & multi-instance

By default every PortQueue process is interchangeable: any worker claims any job. That is the
right model for stateless work. When work benefits from **locality** — a warm cache, a GPU, more
RAM, a region — you can steer jobs to a class of servers using a **pattern**, while staying safe if
those servers disappear. This is **opt-in** and off by default.

## Enabling multi-instance mode

Give each process a stable `instanceKey`. That single option turns on the whole feature: the
process registers a heartbeat row, honours job affinity, and can be paused on its own from the
dashboard.

```ts
const pq = new PortQueue({
  driver,
  instanceKey: '10.0.1.7:ram-8gb:cpu-4cor', // stable, human-meaningful id for this process
});
```

**Every process that participates must set an `instanceKey`.** Run the *same* code on all your
servers; only the key differs per process (derive it from the environment). A process without an
`instanceKey` runs in **single-instance mode** — affinity options are rejected and the instances
table stays empty.

### Design keys that scale

Encode a server's **capabilities** in its key, not just its name — then you target by capability,
and adding/replacing hardware needs no code changes. A good shape packs the identity and the
attributes you might want to target:

```
{container-id-or-ip}:ram-{ram}gb:cpu-{cpu}cor
→ "10.0.1.7:ram-8gb:cpu-4cor", "10.0.2.3:ram-2gb:cpu-1cor"
```

### Typing the instance keys

`PortQueue` takes an optional second type parameter — a union of your instance keys — so
`instanceKey` is checked at compile time:

```ts
type Instance = `10.0.1.7:ram-8gb:cpu-4cor` | `10.0.2.3:ram-2gb:cpu-1cor`;
const pq = new PortQueue<'emails' | 'reports', Instance>({ driver, instanceKey: '10.0.1.7:ram-8gb:cpu-4cor' });
```

## Targeting jobs with a pattern

`addJob` accepts a single affinity option, `preferredInstanceKeyPattern` — a regular-expression
**source string** matched against instance keys. It requires multi-instance mode; passing it from a
process with no `instanceKey` throws.

```ts
// Run this job only on 4 GB or 8 GB servers.
await queue.addJob({ data, preferredInstanceKeyPattern: 'ram-(4|8)gb' });
```

There is **no exact-key pin and no fallback tier** by design: a pattern already spans many
servers, so the first matching instance to poll takes the job. Patterns are case-sensitive and
validated when the job is added.

### How claiming decides

At claim time an instance may take a job when:

1. the job has **no pattern** (runs anywhere); or
2. the job's pattern **matches this instance's key**.

If no live instance matches, the job simply **waits** until one does — nothing runs it "by
accident". Prefer broad, capability-based patterns (`ram-(4|8)gb`) over narrow host pins so work is
never stranded when a single server goes away.

> Because affinity uses regexes and the schema is index-free, the claim path evaluates affinity
> **in the tool**, not in SQL. It pages through candidates highest-priority-first and keeps only the
> ones this instance matches, stopping when the batch is full or the backlog is exhausted — so an
> instance is never starved by a burst of jobs meant for others. Over LISTEN/NOTIFY, a wakeup for a
> job whose pattern can't match this instance is skipped outright.

## Retiring or replacing a server

Because affinity is a **pattern**, not a host pin, replacing a server is usually a no-op: start a
new process whose key matches the same pattern (e.g. another `…:ram-8gb:…` box) and it picks up the
pending work automatically. This is why you should **build meaningful, scalable patterns from the
start** — target *what the job needs*, not *which machine*.

If you did pin work to a now-gone class of servers with a narrow pattern, reroute it by widening the
`preferred_instance_key_pattern` on the still-pending job rows to match the replacements; matching
instances then claim them on the next poll.

## Pausing a single instance

An individual instance can stop processing without stopping the others. This is persisted, so it
survives restarts and can be driven from the dashboard:

```ts
await pq.pauseInstance({ instanceKey: '10.0.1.7:ram-8gb:cpu-4cor' });
await pq.resumeInstance({ instanceKey: '10.0.1.7:ram-8gb:cpu-4cor' });
```

A paused instance keeps heartbeating (so it still shows as alive) but claims no jobs until resumed.

## Removing an instance from monitoring

When a server is decommissioned its instance row lingers in the instances list. You can remove that
row once the instance has been **inactive for at least 30 minutes** (a live or recently-seen
instance would just re-register on its next heartbeat, so removal is refused until then).

This is safe: jobs record the processing instance as a plain string (`processed_on_instance_key`),
never a foreign key to the instances table, so removing an instance row **never touches or orphans
any job** — it only tidies the list. The tool never removes instances on its own.

```ts
await pq.removeInstance({ instanceKey: '10.0.9.9:ram-2gb:cpu-1cor' }); // throws if seen < 30 min ago
```

- **Dashboard** → **Instances**: a **Remove** action appears on any instance last seen over 30
  minutes ago.
- **CLI**: `portqueue remove-instance --instance-key <key>`.

## Removing a queue

The tool **never** deletes a queue automatically — a queue row is cheap and its absence would just
be recreated on the next `createQueue`. Removal is a deliberate admin action, and it is allowed
**only when the queue is not in use**: no running process that you're operating from still declares
it via `createQueue`/`createWorker`.

Because you should run the **same code on every server** — identical `createQueue` calls everywhere
— a queue is either used by your app or it isn't; there's no per-server drift to reconcile. For that
reason (and for performance) queues are **not** liveness-monitored the way instances are: there is
no `last_seen` on a queue. "In use" is judged by the in-memory registry of the process handling the
removal (the dashboard server or the CLI).

- **Dashboard**: each queue shows an **in use / unused** indicator; a **Remove queue** action
  appears only on **unused** queues (from the dashboard server's own perspective).
- **CLI**: `portqueue remove-queue --queue <name>` (refused if that process declares the queue).

Removing a queue deletes only the queue row; existing job rows link by name and are left untouched.

## Observing attribution

Each processed job records the instance that ran it in `processedOnInstanceKey`
(`JobSnapshot.processedOnInstanceKey`), and `pq.getInstances()` returns liveness plus per-instance
counts for your own dashboards. `INSTANCE_PAUSED` / `INSTANCE_RESUMED` / `INSTANCE_REMOVED` and
`QUEUE_REMOVED` are emitted as events and streamed live to the dashboard.
