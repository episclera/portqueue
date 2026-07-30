/**
 * The dashboard's own PortQueue.
 *
 * `createDashboard` takes a **driver**, not a running `PortQueue`. That is the whole point: the
 * dashboard is an operations console for a deployment, and in almost every real deployment it is a
 * different process from the workers — so being handed the app's client only ever worked in the one
 * case where they happened to share a process, and it quietly coupled the two.
 *
 * The client it builds is **headless** (`_headless: true`), which is what keeps an observer from
 * behaving like a participant:
 *
 * - it declares no queues and writes no queue rows, so browsing never creates anything;
 * - it registers no instance row, so the dashboard never shows up in its own instances list;
 * - it runs no workers, scheduler, retention sweep or health monitor — the app's processes own that
 *   work, and a dashboard quietly firing the cluster's schedules would be a second producer nobody
 *   asked for;
 * - it never migrates: pointing the dashboard at a database must not change its schema.
 *
 * `init()` is deferred to the first request and memoized, because `createDashboard` is synchronous
 * and a mount must not open a connection the host may never use.
 */
import { PortQueue } from '@portqueue/core';
import type { Driver, Logger } from '@portqueue/core';

export interface DashboardClient {
  /** The initialized client. Connects on the first call; every later call reuses it. */
  get(): Promise<PortQueue>;
  /** Disconnect, if a request ever caused a connection. Safe to call more than once. */
  close(): Promise<void>;
}

export function createDashboardClient(options: {
  driver: Driver;
  logger?: Pick<Logger, 'warn'>;
}): DashboardClient {
  let started: Promise<PortQueue> | null = null;
  let instance: PortQueue | null = null;

  return {
    get(): Promise<PortQueue> {
      if (!started) {
        started = (async () => {
          const pq = new PortQueue({ driver: options.driver, _headless: true });
          await pq.init();
          instance = pq;
          return pq;
        })().catch((err: unknown) => {
          // Don't cache a failed connection — the next request must be able to retry.
          started = null;
          throw err;
        });
      }
      return started;
    },
    async close(): Promise<void> {
      const pq = instance;
      started = null;
      instance = null;
      if (pq) await pq.shutdown();
    },
  };
}
