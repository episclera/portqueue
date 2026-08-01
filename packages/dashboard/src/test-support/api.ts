/**
 * Test harness for the JSON API: a `DashboardClient` that connects to nothing, a `PortQueue` that
 * records what a route asked of it, and the two one-liners that drive the router.
 *
 * Shared because every route test needs the same three things, and a fake that drifts per file is a
 * fake that stops proving anything.
 */
import { createRouter } from '../server/api/routes';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_MARKER } from '../shared/constants';
import type { JobBatchAction, PortQueue } from '@portqueue/core';
import type { DashboardClient } from '../server/client';
import type { ActionRequestDto, ActionResultDto } from '../shared/dto';

const BASE_PATH = '/portqueue';

/** A `DashboardClient` that hands back a ready-made fake instead of opening a connection. */
export function stubClient(pq: PortQueue): DashboardClient {
  return { get: async () => pq, close: async () => {} };
}

/** A client whose first (and every) resolution fails, for the unreachable-database case. */
export function failingClient(error: Error): DashboardClient {
  return {
    get: async () => {
      throw error;
    },
    close: async () => {},
  };
}

/** What the fake recorded about the calls a route made. */
export interface Recorded {
  batches: { jobIds: string[]; action: JobBatchAction }[];
  scheduleRemovals: string[][];
  scheduleToggles: { scheduleId: string; enabled: boolean }[];
  adds: unknown[];
  /** Names of the public `PortQueue` methods called, in order. */
  calls: string[];
}

export interface FakePqOverrides {
  batchResult?: { affected: number; requested: number; signalled?: number };
  scheduleEnabled?: boolean;
  schedulesRemoved?: { affected: number; requested: number };
  /** Make the named method throw, so a test can drive core's refusal paths. */
  throwOn?: { method: string; error: Error };
  addResult?: { jobId?: string; scheduleId?: string };
}

/** A PortQueue that records what a route asked of it, with overridable outcomes. */
export function fakePq(over: FakePqOverrides = {}): { pq: PortQueue; rec: Recorded } {
  const rec: Recorded = {
    batches: [],
    scheduleRemovals: [],
    scheduleToggles: [],
    adds: [],
    calls: [],
  };

  /** Throw for the named method when the test asked it to, else return `value`. */
  const maybeThrow = <T>(method: string, value: T): T => {
    rec.calls.push(method);
    if (over.throwOn?.method === method) throw over.throwOn.error;
    return value;
  };

  const pq = {
    _dashboard: {
      runJobBatch: async (opts: { jobIds: string[]; action: JobBatchAction }) => {
        rec.batches.push(opts);
        return over.batchResult ?? { affected: opts.jobIds.length, requested: opts.jobIds.length };
      },
      removeSchedules: async (opts: { scheduleIds: string[] }) => {
        rec.scheduleRemovals.push(opts.scheduleIds);
        return (
          over.schedulesRemoved ?? {
            affected: opts.scheduleIds.length,
            requested: opts.scheduleIds.length,
          }
        );
      },
      setScheduleEnabled: async (opts: { scheduleId: string; enabled: boolean }) => {
        rec.scheduleToggles.push(opts);
        return over.scheduleEnabled ?? true;
      },
    },
    addJob: async (opts: { queue: string }) => {
      rec.adds.push(opts);
      if (over.throwOn?.method === 'addJob') throw over.throwOn.error;
      return over.addResult ?? { jobId: 'job-new', queue: opts.queue, deduplicated: false };
    },
    pauseQueue: async () => maybeThrow('pauseQueue', undefined),
    resumeQueue: async () => maybeThrow('resumeQueue', undefined),
    removeQueue: async () => maybeThrow('removeQueue', true),
    pauseInstance: async () => maybeThrow('pauseInstance', undefined),
    resumeInstance: async () => maybeThrow('resumeInstance', undefined),
    removeInstance: async () => maybeThrow('removeInstance', true),
  } as unknown as PortQueue;

  return { pq, rec };
}

export interface ActionResponse {
  status: number;
  body: ActionResultDto & { error?: string };
}

/**
 * POST a mutation to its own endpoint (`/api/actions/<kind>`) and parse the reply.
 *
 * The `kind` is split out of the object exactly as the client's `api.action` does, so a test writes
 * the mutation as one literal and still exercises the real routing.
 */
export async function postAction(
  pq: PortQueue,
  action: (ActionRequestDto | Record<string, unknown>) & { kind: string },
): Promise<ActionResponse> {
  const { kind, ...payload } = action;
  return postRaw(pq, kind, JSON.stringify(payload));
}

/** POST an arbitrary (possibly malformed) body to one action's endpoint. */
export async function postRaw(
  pq: PortQueue,
  kind: string,
  body: string | undefined,
): Promise<ActionResponse> {
  const router = createRouter({ client: stubClient(pq), basePath: BASE_PATH });
  const res = await router.handle({
    method: 'POST',
    url: `${BASE_PATH}/api/actions/${encodeURIComponent(kind)}`,
    body,
    headers: { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_MARKER },
  });
  return { status: res.status, body: JSON.parse(res.body) as ActionResultDto };
}

/**
 * Drive one request through the router, whatever its method or path. Mutations carry the
 * same-origin marker unless the caller passes its own headers — a test for the CSRF guard says so
 * explicitly by passing `headers: {}`.
 */
export function request(
  client: DashboardClient,
  input: {
    method: string;
    url: string;
    body?: string;
    headers?: Record<string, string | string[] | undefined>;
  },
): Promise<{ status: number; body: string }> {
  const router = createRouter({ client, basePath: BASE_PATH });
  return router
    .handle({
      method: input.method,
      url: input.url,
      body: input.body,
      headers: input.headers ?? { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_MARKER },
    })
    .then((res) => ({ status: res.status, body: res.body }));
}
