/**
 * Framework-agnostic JSON API + SSE event stream.
 *
 * The core is a pure `handle(input) => Promise<HandlerResult>` for JSON endpoints, plus a
 * separate SSE helper the node adapter wires to the response socket. All mutations are gated
 * by auth, `readOnly`, and a same-origin CSRF check. No magic status strings — core enums only.
 */
import {
  JobStatus,
  PauseMode,
  PortQueueEvent,
  type PortQueue,
  type GetJobsQuery,
  type AddJobOptions,
} from '@portqueue/core';
import { authorize, type DashboardAuth, type AuthRequest } from './auth';
import {
  serializeJob,
  serializeJobPage,
  serializeQueue,
  serializeSchedule,
  serializeStats,
  serializeWorkflow,
  serializeInstance,
} from './serialize';
import type { ActionRequestDto, ActionResultDto } from '../../shared/dto';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_MARKER } from '../../shared/constants';

export interface RouterOptions {
  portQueue: PortQueue;
  basePath: string;
  auth?: DashboardAuth;
  readOnly: boolean;
}

export interface HandlerInput {
  method: string;
  /** URL path + query, already stripped to be relative-friendly (may still include basePath). */
  url: string;
  body: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

export interface HandlerResult {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const JSON_HEADERS: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };

function json(status: number, payload: unknown, extra?: Record<string, string>): HandlerResult {
  return { status, body: JSON.stringify(payload), headers: { ...JSON_HEADERS, ...extra } };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Strip the mount base path so route matching sees `/api/...` or `/events`. */
function relativePath(url: string, basePath: string): string {
  const qIndex = url.indexOf('?');
  let path = qIndex === -1 ? url : url.slice(0, qIndex);
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
  if (!path.startsWith('/')) path = `/${path}`;
  return path;
}

function query(url: string): URLSearchParams {
  const qIndex = url.indexOf('?');
  return new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1));
}

/**
 * Same-origin CSRF guard for mutations: the Origin/Referer host must match the Host header.
 * Browsers always send Origin on cross-origin state-changing fetches, so a mismatch is rejected.
 */
function sameOrigin(headers: HandlerInput['headers']): boolean {
  const host = firstHeader(headers['host']);
  if (!host) return false;
  const origin = firstHeader(headers['origin']);
  const referer = firstHeader(headers['referer']);
  const source = origin ?? referer;
  if (!source) {
    // No Origin/Referer (e.g. a non-browser client). Require an explicit fetch marker.
    return firstHeader(headers[REQUESTED_WITH_HEADER]) === REQUESTED_WITH_MARKER;
  }
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

function parseStatuses(raw: string | null): JobStatus[] | undefined {
  if (!raw) return undefined;
  const valid = new Set<string>(Object.values(JobStatus));
  const out = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => valid.has(s)) as JobStatus[];
  return out.length ? out : undefined;
}

function buildJobsQuery(params: URLSearchParams): GetJobsQuery {
  const q: GetJobsQuery = {};
  const queue = params.get('queue');
  if (queue) q.queue = queue;
  const statuses = parseStatuses(params.get('statuses'));
  if (statuses) q.statuses = statuses;
  const scheduleId = params.get('scheduleId');
  if (scheduleId) q.scheduleId = scheduleId;
  const workflowId = params.get('workflowId');
  if (workflowId) q.workflowId = workflowId;
  const limit = params.get('limit');
  if (limit && Number.isFinite(Number(limit))) q.limit = Math.min(Math.max(Number(limit), 1), 200);
  const cursor = params.get('cursor');
  if (cursor) q.cursor = cursor;
  const order = params.get('order');
  if (order === 'asc' || order === 'desc') q.order = order;
  return q;
}

/** Build the core AddJobOptions from a validated action body. */
function buildAddOptions(add: NonNullable<ActionRequestDto['add']>): AddJobOptions<unknown> {
  const opts: AddJobOptions<unknown> = { data: add.data };
  if (typeof add.priority === 'number') opts.priority = add.priority;
  if (add.idempotencyKey) opts.idempotencyKey = add.idempotencyKey;
  if (add.singletonKey) opts.singletonKey = add.singletonKey;
  const schedule: NonNullable<AddJobOptions<unknown>['schedule']> = {};
  if (add.startAfter != null) schedule.startAfter = add.startAfter as never;
  if (add.cron != null) schedule.cron = add.cron;
  else if (add.startEvery != null) schedule.startEvery = add.startEvery as never;
  if (Object.keys(schedule).length > 0) opts.schedule = schedule;
  return opts;
}

/**
 * Create the router. Returns the pure JSON handler and metadata the node adapter uses for
 * routing (asset serving vs API vs SSE).
 */
export function createRouter(options: RouterOptions): {
  handle: (input: HandlerInput) => Promise<HandlerResult>;
  isEventsPath: (url: string) => boolean;
  isApiPath: (url: string) => boolean;
  authRequest: (input: HandlerInput) => AuthRequest;
} {
  const { portQueue, basePath, auth, readOnly } = options;

  const authRequest = (input: HandlerInput): AuthRequest => ({
    method: input.method,
    url: input.url,
    headers: input.headers,
  });

  const isEventsPath = (url: string): boolean => relativePath(url, basePath) === '/api/events';
  const isApiPath = (url: string): boolean => relativePath(url, basePath).startsWith('/api/');

  async function handle(input: HandlerInput): Promise<HandlerResult> {
    const decision = await authorize(auth, authRequest(input));
    if (!decision.authorized) {
      const extra = decision.challenge ? { 'www-authenticate': decision.challenge } : undefined;
      return json(401, { error: 'Unauthorized' }, extra);
    }
    const effectiveReadOnly = readOnly || decision.readOnly;

    const path = relativePath(input.url, basePath);
    const method = input.method.toUpperCase();
    const params = query(input.url);

    // --- Reads (GET) ---
    if (method === 'GET') {
      if (path === '/api/config') {
        return json(200, { readOnly: effectiveReadOnly });
      }
      if (path === '/api/queues') {
        const queues = await portQueue.getQueues();
        return json(200, queues.map(serializeQueue));
      }
      if (path === '/api/stats') {
        const queue = params.get('queue') ?? undefined;
        const stats = await portQueue.getQueueStats(queue ? { queue } : {});
        return json(200, serializeStats(stats));
      }
      if (path === '/api/jobs') {
        const page = await portQueue.getJobs(buildJobsQuery(params));
        return json(200, serializeJobPage(page));
      }
      if (path === '/api/instances') {
        // Real instance rows with liveness + per-instance job attribution.
        const instances = await portQueue.getInstances();
        return json(200, instances.map(serializeInstance));
      }
      const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(path);
      if (jobMatch && jobMatch[1]) {
        const job = await portQueue.getJob({ jobId: decodeURIComponent(jobMatch[1]) });
        if (!job) return json(404, { error: 'Job not found' });
        return json(200, serializeJob(job));
      }
      const wfMatch = /^\/api\/workflows\/([^/]+)$/.exec(path);
      if (wfMatch && wfMatch[1]) {
        const wf = await portQueue.getWorkflow({ workflowId: decodeURIComponent(wfMatch[1]) });
        if (!wf) return json(404, { error: 'Workflow not found' });
        return json(200, serializeWorkflow(wf));
      }
      if (path === '/api/schedules') {
        const queueFilter = params.get('queue') ?? undefined;
        const queues = await portQueue.getQueues();
        const names = queueFilter ? [queueFilter] : queues.map((q) => q.name);
        const out = [];
        for (const name of names) {
          const q = portQueue.createQueue(name);
          const schedules = await q.getSchedules();
          for (const s of schedules) out.push(serializeSchedule(s, name));
        }
        return json(200, out);
      }
      return json(404, { error: 'Not found' });
    }

    // --- Mutations (POST) ---
    if (method === 'POST' && path === '/api/actions') {
      if (effectiveReadOnly) return json(403, { error: 'Dashboard is read-only' });
      if (!sameOrigin(input.headers)) return json(403, { error: 'Cross-origin request rejected' });
      let action: ActionRequestDto;
      try {
        action = JSON.parse(input.body ?? '') as ActionRequestDto;
      } catch {
        return json(400, { error: 'Invalid JSON body' });
      }
      return runAction(portQueue, action);
    }

    return json(404, { error: 'Not found' });
  }

  return { handle, isEventsPath, isApiPath, authRequest };
}

/** Execute a validated mutation against the provided PortQueue instance. */
async function runAction(portQueue: PortQueue, action: ActionRequestDto): Promise<HandlerResult> {
  // Instance actions are queue-less and handled up front.
  if (action?.kind === 'pauseInstance' || action?.kind === 'resumeInstance') {
    if (typeof action.instanceKey !== 'string' || !action.instanceKey) {
      return json(400, { error: 'Missing instanceKey' });
    }
    if (action.kind === 'pauseInstance')
      await portQueue.pauseInstance({ instanceKey: action.instanceKey });
    else await portQueue.resumeInstance({ instanceKey: action.instanceKey });
    return json(200, { ok: true } satisfies ActionResultDto);
  }
  if (action?.kind === 'removeInstance') {
    if (typeof action.instanceKey !== 'string' || !action.instanceKey) {
      return json(400, { error: 'Missing instanceKey' });
    }
    try {
      const ok = await portQueue.removeInstance({ instanceKey: action.instanceKey });
      return json(200, { ok } satisfies ActionResultDto);
    } catch (err) {
      // e.g. still-active instance — surface the actionable message as a conflict.
      return json(409, { error: err instanceof Error ? err.message : 'Cannot remove instance' });
    }
  }
  if (action?.kind === 'removeQueue') {
    if (typeof action.queue !== 'string' || !action.queue) {
      return json(400, { error: 'Missing queue' });
    }
    // Deliberately not createQueue() — that would register it in this process and trip the guard.
    try {
      const ok = await portQueue.removeQueue({ name: action.queue });
      return json(200, { ok } satisfies ActionResultDto);
    } catch (err) {
      return json(409, { error: err instanceof Error ? err.message : 'Cannot remove queue' });
    }
  }

  if (!action || typeof action.queue !== 'string' || !action.queue) {
    return json(400, { error: 'Missing queue' });
  }
  const queue = portQueue.createQueue(action.queue);

  switch (action.kind) {
    case 'pause': {
      const mode = action.mode === PauseMode.ALL ? PauseMode.ALL : PauseMode.PROCESSING;
      await queue.pause({ mode });
      return json(200, { ok: true } satisfies ActionResultDto);
    }
    case 'resume': {
      await queue.resume();
      return json(200, { ok: true } satisfies ActionResultDto);
    }
    case 'retry': {
      if (!action.jobId) return json(400, { error: 'Missing jobId' });
      const result = await queue.retryJob({ jobId: action.jobId });
      return json(200, {
        ok: true,
        ...(result.jobId ? { jobId: result.jobId } : {}),
      } satisfies ActionResultDto);
    }
    case 'remove': {
      if (action.jobIds && action.jobIds.length) {
        const affected = await queue.removeJobs({ jobIds: action.jobIds });
        return json(200, { ok: true, affected } satisfies ActionResultDto);
      }
      if (!action.jobId) return json(400, { error: 'Missing jobId(s)' });
      const ok = await queue.removeJob({ jobId: action.jobId });
      return json(200, { ok } satisfies ActionResultDto);
    }
    case 'cancel': {
      if (!action.jobId) return json(400, { error: 'Missing jobId' });
      const ok = await queue.cancelJob({ jobId: action.jobId });
      return json(200, { ok } satisfies ActionResultDto);
    }
    case 'purge': {
      const statuses = action.statuses?.filter((s) => Object.values(JobStatus).includes(s)) ?? [];
      if (!statuses.length) return json(400, { error: 'Missing statuses' });
      const affected = await queue.removeJobs({ statuses });
      return json(200, { ok: true, affected } satisfies ActionResultDto);
    }
    case 'add': {
      if (!action.add || typeof action.add !== 'object')
        return json(400, { error: 'Missing add payload' });
      const result = await queue.addJob(buildAddOptions(action.add));
      return json(200, {
        ok: true,
        ...(result.jobId ? { jobId: result.jobId } : {}),
        ...(result.scheduleId ? { scheduleId: result.scheduleId } : {}),
      } satisfies ActionResultDto);
    }
    case 'removeSchedule': {
      if (!action.scheduleId) return json(400, { error: 'Missing scheduleId' });
      const ok = await queue.removeSchedule({ scheduleId: action.scheduleId });
      return json(200, { ok } satisfies ActionResultDto);
    }
    default:
      return json(400, { error: 'Unknown action' });
  }
}

/** The set of events the SSE stream forwards. */
export const STREAMED_EVENTS: readonly PortQueueEvent[] = [
  PortQueueEvent.JOB_ADDED,
  PortQueueEvent.JOB_ACTIVE,
  PortQueueEvent.JOB_COMPLETED,
  PortQueueEvent.JOB_FAILED,
  PortQueueEvent.JOB_RETRYING,
  PortQueueEvent.JOB_STALLED,
  PortQueueEvent.JOB_EXPIRED,
  PortQueueEvent.JOB_CANCELLED,
  PortQueueEvent.JOB_REMOVED,
  PortQueueEvent.WORKFLOW_COMPLETED,
  PortQueueEvent.WORKFLOW_FAILED,
  PortQueueEvent.QUEUE_PAUSED,
  PortQueueEvent.QUEUE_RESUMED,
  PortQueueEvent.QUEUE_REMOVED,
  PortQueueEvent.INSTANCE_PAUSED,
  PortQueueEvent.INSTANCE_RESUMED,
  PortQueueEvent.INSTANCE_REMOVED,
  PortQueueEvent.SCHEDULE_CREATED,
  PortQueueEvent.SCHEDULE_UPDATED,
  PortQueueEvent.SCHEDULE_REMOVED,
  PortQueueEvent.SCHEDULE_FIRED,
];

/**
 * Subscribe to PortQueue events and push SSE lines through `write`. Returns an unsubscribe
 * that detaches every listener. Uses plain Node/SSE framing — no dependency.
 */
export function subscribeEvents(portQueue: PortQueue, write: (line: string) => void): () => void {
  const unsubs = STREAMED_EVENTS.map((event) =>
    portQueue.on(event, (payload) => {
      // Non-blocking best-effort push; a broken pipe is swallowed by the caller.
      try {
        write(`event: ${event}\ndata: ${JSON.stringify({ event, payload })}\n\n`);
      } catch {
        /* ignore write errors; the stream will be torn down */
      }
    }),
  );
  return () => {
    for (const off of unsubs) off();
  };
}
