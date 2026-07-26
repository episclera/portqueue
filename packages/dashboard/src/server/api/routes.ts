/**
 * Framework-agnostic JSON API. A pure `handle(input) => Promise<HandlerResult>`; the adapters
 * only translate their framework's request into {@link HandlerInput} and write the result back.
 *
 * Everything here goes through `portQueue._dashboard` — core's internal dashboard facade — rather
 * than the public API. Two reasons, both load-bearing:
 *
 * - The facade never calls `createQueue`, which would register the queue in the host's process
 *   and permanently flip `inUse`. Only the actions that genuinely operate a queue take a `Queue`
 *   handle, and they take the developer's own.
 * - Anything the dashboard needs that the public API doesn't document lives on the facade, so a
 *   dashboard feature never reshapes `PortQueue`. See CLAUDE.md.
 *
 * There is **no authentication and no read-only mode here**: protecting the mount belongs to
 * whatever middleware the host puts in front of it (see `docs/docs/dashboard.mdx`). Anyone who
 * can reach these routes can perform every action.
 */
import {
  JobBatchAction,
  JobStatus,
  PauseMode,
  type PortQueue,
  type GetJobsQuery,
  type JobInstanceFilter,
  type AddJobOptions,
} from '@portqueue/core';
import {
  serializeInstance,
  serializeInstancePage,
  serializeJob,
  serializeJobPage,
  serializeQueuePage,
  serializeSchedule,
  serializeSchedulePage,
  serializeStats,
} from './serialize';
import { ActionKind, type ActionRequestDto, type ActionResultDto } from '../../shared/dto';

export interface RouterOptions {
  portQueue: PortQueue;
  basePath: string;
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

/** Strip the mount base path so route matching sees `/api/...`. */
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

/** Default page size, so no read path re-guesses core's own default. */
const DEFAULT_LIMIT = 50;

/** Read a paging window from the query string, clamped to something sane. */
function paging(params: URLSearchParams): { limit: number; offset: number } {
  const rawLimit = Number(params.get('limit'));
  const rawOffset = Number(params.get('offset'));
  return {
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.trunc(rawLimit), 200)
        : DEFAULT_LIMIT,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0,
  };
}

/** A tri-state boolean query param: `true`/`false` narrow, anything else means "don't filter". */
function triBool(raw: string | null): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
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

function buildJobsQuery(params: URLSearchParams): GetJobsQuery & JobInstanceFilter {
  const { limit, offset } = paging(params);
  const q: GetJobsQuery & JobInstanceFilter = { limit, offset };
  const queue = params.get('queue');
  if (queue) q.queue = queue;
  const statuses = parseStatuses(params.get('statuses'));
  if (statuses) q.statuses = statuses;
  const scheduleId = params.get('scheduleId');
  if (scheduleId) q.scheduleId = scheduleId;
  const instanceKey = params.get('instanceKey');
  if (instanceKey) q.instanceKey = instanceKey;
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
  if (typeof add.retryMaxAttempts === 'number') {
    opts.retry = { maxAttempts: add.retryMaxAttempts };
  }
  if (add.preferredInstanceKeyPattern) {
    opts.preferredInstanceKeyPattern = add.preferredInstanceKeyPattern;
  }
  const schedule: NonNullable<AddJobOptions<unknown>['schedule']> = {};
  if (add.startAfterSeconds != null) schedule.startAfterSeconds = add.startAfterSeconds;
  if (add.cron != null) schedule.cron = add.cron;
  else if (add.startEverySeconds != null) schedule.startEverySeconds = add.startEverySeconds;
  if (Object.keys(schedule).length > 0) opts.schedule = schedule;
  return opts;
}

/**
 * Create the router. Returns the pure JSON handler plus the path predicate the adapters use to
 * decide between an API call and a static asset.
 */
export function createRouter(options: RouterOptions): {
  handle: (input: HandlerInput) => Promise<HandlerResult>;
  isApiPath: (url: string) => boolean;
} {
  const { portQueue, basePath } = options;
  const dashboard = portQueue._dashboard;

  const isApiPath = (url: string): boolean => relativePath(url, basePath).startsWith('/api/');

  async function handleGet(path: string, params: URLSearchParams): Promise<HandlerResult> {
    if (path === '/api/config') {
      // Kept so a client can confirm it is talking to a PortQueue dashboard.
      return json(200, { ok: true });
    }

    if (path === '/api/queues') {
      const page = await dashboard.getQueues({
        ...paging(params),
        ...(params.get('search') ? { search: params.get('search')! } : {}),
        ...(triBool(params.get('processingPaused')) !== undefined
          ? { processingPaused: triBool(params.get('processingPaused'))! }
          : {}),
        ...(triBool(params.get('inUse')) !== undefined
          ? { inUse: triBool(params.get('inUse'))! }
          : {}),
      });
      return json(200, serializeQueuePage(page));
    }

    if (path === '/api/instances') {
      const page = await dashboard.getInstances({
        ...paging(params),
        ...(params.get('search') ? { search: params.get('search')! } : {}),
        ...(triBool(params.get('processingPaused')) !== undefined
          ? { processingPaused: triBool(params.get('processingPaused'))! }
          : {}),
        ...(triBool(params.get('alive')) !== undefined
          ? { alive: triBool(params.get('alive'))! }
          : {}),
      });
      return json(200, serializeInstancePage(page));
    }

    const instanceMatch = /^\/api\/instances\/([^/]+)$/.exec(path);
    if (instanceMatch?.[1]) {
      const instance = await dashboard.getInstance({
        instanceKey: decodeURIComponent(instanceMatch[1]),
      });
      if (!instance) return json(404, { error: 'Instance not found' });
      return json(200, serializeInstance(instance));
    }

    if (path === '/api/schedules') {
      const page = await dashboard.getSchedules({
        ...paging(params),
        ...(params.get('queue') ? { queue: params.get('queue')! } : {}),
        ...(params.get('search') ? { search: params.get('search')! } : {}),
        ...(triBool(params.get('enabled')) !== undefined
          ? { enabled: triBool(params.get('enabled'))! }
          : {}),
      });
      return json(200, serializeSchedulePage(page));
    }

    const scheduleMatch = /^\/api\/schedules\/([^/]+)$/.exec(path);
    if (scheduleMatch?.[1]) {
      const schedule = await dashboard.getSchedule({
        scheduleId: decodeURIComponent(scheduleMatch[1]),
      });
      if (!schedule) return json(404, { error: 'Schedule not found' });
      return json(200, serializeSchedule(schedule));
    }

    if (path === '/api/stats') {
      const queue = params.get('queue');
      const stats = await dashboard.getStats(queue ? { queue } : {});
      return json(200, serializeStats(stats));
    }

    if (path === '/api/jobs') {
      const page = await dashboard.getJobs({
        ...buildJobsQuery(params),
        ...(params.get('search') ? { search: params.get('search')! } : {}),
      });
      return json(200, serializeJobPage(page));
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(path);
    if (jobMatch?.[1]) {
      const job = await portQueue.getJob({ jobId: decodeURIComponent(jobMatch[1]) });
      if (!job) return json(404, { error: 'Job not found' });
      return json(200, serializeJob(job));
    }

    return json(404, { error: 'Not found' });
  }

  async function handle(input: HandlerInput): Promise<HandlerResult> {
    const path = relativePath(input.url, basePath);
    const method = input.method.toUpperCase();

    if (method === 'GET') return handleGet(path, query(input.url));

    if (method === 'POST' && path === '/api/actions') {
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

  return { handle, isApiPath };
}

/** A 409 carrying the actionable message core threw (queue in use, instance still active, …). */
function conflict(err: unknown, fallback: string): HandlerResult {
  return json(409, { error: err instanceof Error ? err.message : fallback });
}

/** Execute a validated mutation against the provided PortQueue instance. */
async function runAction(portQueue: PortQueue, action: ActionRequestDto): Promise<HandlerResult> {
  const dashboard = portQueue._dashboard;

  // --- Instance actions (queue-less) ---
  if (
    action?.kind === ActionKind.PAUSE_INSTANCE ||
    action?.kind === ActionKind.RESUME_INSTANCE ||
    action?.kind === ActionKind.REMOVE_INSTANCE
  ) {
    if (typeof action.instanceKey !== 'string' || !action.instanceKey) {
      return json(400, { error: 'Missing instanceKey' });
    }
    if (action.kind === ActionKind.PAUSE_INSTANCE) {
      await portQueue.pauseInstance({ instanceKey: action.instanceKey });
      return json(200, { ok: true } satisfies ActionResultDto);
    }
    if (action.kind === ActionKind.RESUME_INSTANCE) {
      await portQueue.resumeInstance({ instanceKey: action.instanceKey });
      return json(200, { ok: true } satisfies ActionResultDto);
    }
    try {
      const ok = await portQueue.removeInstance({ instanceKey: action.instanceKey });
      return json(200, { ok } satisfies ActionResultDto);
    } catch (err) {
      return conflict(err, 'Cannot remove instance');
    }
  }

  // --- Schedule actions (resolve their own queue from the id) ---
  if (action?.kind === ActionKind.REMOVE_SCHEDULE) {
    const ids = action.scheduleIds?.length
      ? action.scheduleIds
      : action.scheduleId
        ? [action.scheduleId]
        : [];
    if (!ids.length) return json(400, { error: 'Missing scheduleId(s)' });
    // One transaction for the whole set — a bulk removal can't half-apply.
    const result = await dashboard.removeSchedules({ scheduleIds: ids });
    return json(200, {
      ok: result.affected > 0,
      affected: result.affected,
      requested: result.requested,
    } satisfies ActionResultDto);
  }

  if (action?.kind === ActionKind.SET_SCHEDULE_ENABLED) {
    if (!action.scheduleId) return json(400, { error: 'Missing scheduleId' });
    if (typeof action.enabled !== 'boolean') return json(400, { error: 'Missing enabled' });
    const ok = await dashboard.setScheduleEnabled({
      scheduleId: action.scheduleId,
      enabled: action.enabled,
    });
    return json(200, { ok } satisfies ActionResultDto);
  }

  if (action?.kind === ActionKind.REMOVE_QUEUE) {
    if (typeof action.queue !== 'string' || !action.queue) {
      return json(400, { error: 'Missing queue' });
    }
    try {
      const ok = await portQueue.removeQueue({ name: action.queue });
      return json(200, { ok } satisfies ActionResultDto);
    } catch (err) {
      return conflict(err, 'Cannot remove queue');
    }
  }

  // --- Queue-scoped actions ---
  if (!action || typeof action.queue !== 'string' || !action.queue) {
    return json(400, { error: 'Missing queue' });
  }
  const queueName = action.queue;

  // Batch job actions go through the facade so every id lands in one transaction.
  const batchAction = BATCH_ACTIONS[action.kind];
  if (batchAction && action.jobIds?.length) {
    const result = await dashboard.runJobBatch({
      queue: queueName,
      jobIds: action.jobIds,
      action: batchAction,
    });
    return json(200, {
      ok: true,
      affected: result.affected,
      requested: result.requested,
    } satisfies ActionResultDto);
  }

  switch (action.kind) {
    case ActionKind.PAUSE: {
      const mode = action.mode === PauseMode.ALL ? PauseMode.ALL : PauseMode.PROCESSING;
      await portQueue.pauseQueue({ queue: queueName, mode });
      return json(200, { ok: true } satisfies ActionResultDto);
    }
    case ActionKind.RESUME: {
      await portQueue.resumeQueue({ queue: queueName });
      return json(200, { ok: true } satisfies ActionResultDto);
    }
    case ActionKind.RETRY:
    case ActionKind.CANCEL:
    case ActionKind.REMOVE: {
      if (!action.jobId) return json(400, { error: 'Missing jobId(s)' });
      // A single id is the one-element case of the same transactional batch.
      const result = await dashboard.runJobBatch({
        queue: queueName,
        jobIds: [action.jobId],
        action: BATCH_ACTIONS[action.kind]!,
      });
      return json(200, {
        ok: result.affected > 0,
        affected: result.affected,
      } satisfies ActionResultDto);
    }
    case ActionKind.ADD: {
      if (!action.add || typeof action.add !== 'object') {
        return json(400, { error: 'Missing add payload' });
      }
      try {
        // Adding is the one action that legitimately produces onto a queue, so it uses the
        // public producer path — and with it every validation core already enforces.
        const result = await portQueue.createQueue(queueName).addJob(buildAddOptions(action.add));
        return json(200, {
          ok: true,
          ...(result.jobId ? { jobId: result.jobId } : {}),
          ...(result.scheduleId ? { scheduleId: result.scheduleId } : {}),
        } satisfies ActionResultDto);
      } catch (err) {
        // Bad cron, both cron and interval, a paused queue — all actionable, none a 500.
        return json(400, { error: err instanceof Error ? err.message : 'Cannot add job' });
      }
    }
    default:
      return json(400, { error: 'Unknown action' });
  }
}

/** Which batch verb each job-scoped action maps to. */
const BATCH_ACTIONS: Partial<Record<ActionKind, JobBatchAction>> = {
  [ActionKind.RETRY]: JobBatchAction.RETRY,
  [ActionKind.CANCEL]: JobBatchAction.CANCEL,
  [ActionKind.REMOVE]: JobBatchAction.REMOVE,
};
