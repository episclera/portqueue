---
id: retention
title: Retention & cleanup
sidebar_label: Retention
---

# Retention & cleanup

By default PortQueue **keeps jobs forever**. For any real workload you should turn on
retention (or your own pruning) so the `job` table doesn't grow unbounded.

Retention resolves per-job (queue → job precedence) and is frozen onto each
`job` row when it finishes. Set it at the **queue** level (there is no client-wide default —
nothing is silently inherited) and override per job when a specific job needs to live longer.

```ts
import { RetentionMode } from '@portqueue/core';

// per-queue default
const emails = pq.createQueue('emails', {
  retention: { mode: RetentionMode.DELETE_AFTER, ttl: '3d' },
});

// per-job override (highest precedence) — keep this one longer
await emails.addJob({ data, retention: { mode: RetentionMode.DELETE_AFTER, ttl: '30d' } });
```

:::tip Keep failed jobs longer
There is **no dead-letter queue** — failed jobs stay in `job` with status `FAILED` for
triage. Keep completed jobs short and failed jobs longer so you always have failures to
inspect and re-run with `retryJob`.
:::

Manual pruning is always available:

```ts
import { JobStatus } from '@portqueue/core';

const emails = pq.createQueue('emails');
await emails.removeJobs({ statuses: [JobStatus.COMPLETED] });
```
