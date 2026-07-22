---
id: multi-instance
title: Multi-instance & execution locality
sidebar_label: Multi-instance
---

# Multi-instance & execution locality

By default every PortQueue process is interchangeable: any worker claims any job. That is the
right model for stateless work. When work benefits from **locality** — a warm cache, a local
file, a GPU, a region — you can pin jobs to a specific instance while staying safe if that
instance dies. This is **opt-in** and off by default.

## Enabling multi-instance mode

Give each process a stable `instanceKey`. That single option turns on the whole feature: the
instance registers a heartbeat row, honours job affinity, and can be paused on its own from the
dashboard.

```ts
const pq = new PortQueue({
  driver,
  instanceKey: 'worker-eu-1', // any stable, human-meaningful id for this process
});
```

Without an `instanceKey`, the process runs in **single-instance mode** — affinity options are
rejected and the instances table stays empty.

### Typing the instance keys

`PortQueue` takes an optional second type parameter — a union of your instance keys — so
`instanceKey` and every affinity option are checked at compile time:

```ts
type Instance = 'worker-eu-1' | 'worker-eu-2' | 'worker-us-1';

const pq = new PortQueue<'emails' | 'reports', Instance>({ driver, instanceKey: 'worker-eu-1' });

await pq.createQueue('reports').addJob({
  data: report,
  preferredInstanceKey: 'worker-eu-2', // ✅ checked against `Instance`
  // preferredInstanceKey: 'typo',      // ❌ compile error
});
```

## Pinning a job to an instance

`addJob` accepts four optional affinity fields. All require multi-instance mode; adding a job
with any of them from a process that has no `instanceKey` throws.

| Option | Meaning |
| --- | --- |
| `preferredInstanceKey` | Run on this exact instance if it is alive. |
| `preferredInstanceKeyPattern` | Run on any **alive** instance whose key matches this regex. |
| `fallbackInstanceKey` | If no preferred instance is alive, run here instead. |
| `fallbackInstanceKeyPattern` | If no preferred instance is alive, run on any alive instance matching this regex. |

You may set the exact key **or** the pattern for a role, never both. Patterns are ordinary
regular-expression source strings (validated when the job is added).

```ts
// Exact pin, with a specific fallback.
await queue.addJob({ data, preferredInstanceKey: 'worker-eu-1', fallbackInstanceKey: 'worker-eu-2' });

// Region pin: any EU worker; fall back to any worker if all EU workers are down.
await queue.addJob({ data, preferredInstanceKeyPattern: '^worker-eu-' });
```

### How claiming decides (liveness-aware)

Each instance heartbeats on a timer (`instanceHeartbeatIntervalMs`, default 15s). An instance
is considered **alive** while its last heartbeat is within three intervals. At claim time an
instance may take a job when:

1. the job is **unpinned**; or
2. the job's preferred target **matches this instance**; or
3. every preferred target is **dead** — then the fallback is consulted the same way, and if the
   fallback is also dead (or unset) **any** instance may rescue the job.

So a job pinned to a crashed instance is never stranded — it is picked up by its fallback, or by
the cluster at large, once the preferred instance stops heartbeating.

> Because affinity uses regexes and the schema is index-free (see below), the claim path
> evaluates affinity **in the tool**, not in SQL. It reads a bounded candidate window per poll,
> so under heavy cross-affinity load a single claim may return fewer jobs than its batch size;
> the next poll picks up the rest.

## Pausing a single instance

Just like queues, an individual instance can stop processing without stopping the others. This
is persisted, so it survives restarts and can be driven from the dashboard:

```ts
await pq.pauseInstance({ instanceKey: 'worker-eu-1' });
await pq.resumeInstance({ instanceKey: 'worker-eu-1' });
```

A paused instance keeps heartbeating (so it still shows as alive) but claims no jobs until
resumed. The target instance picks the flag up on its next heartbeat.

## Dashboard

The dashboard's **Instances** page lists every registered instance with its liveness, per-status
job counts (attributed by `processedOnInstanceKey`), last-seen time, and a per-instance
**Pause/Resume** action. `PortQueueEvent.INSTANCE_PAUSED` / `INSTANCE_RESUMED` are streamed live.

## Observing attribution

Each processed job records the instance that ran it in `processedOnInstanceKey`
(`JobSnapshot.processedOnInstanceKey`), and `pq.getInstances()` returns liveness plus per-instance
counts for your own dashboards.
