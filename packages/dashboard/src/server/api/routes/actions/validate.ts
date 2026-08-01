/**
 * Field checks shared by the action routes.
 *
 * Each returns either the value or a ready-made 400, so a handler reads as a short list of
 * requirements followed by the one call that does the work. A `400` is always the client's mistake:
 * anything core refuses for a legitimate request is a 409 (see `conflict`) or a 400 with core's own
 * message.
 */
import { MAX_BATCH_IDS } from '@portqueue/core';
import { json, type HandlerResult } from '../../http';
import type { ActionPayloadDto } from '../../../../shared/dto';

/** Either a validated value, or the response to send instead. */
export type Checked<T> = { ok: true; value: T } | { ok: false; response: HandlerResult };

const invalid = (error: string): Checked<never> => ({ ok: false, response: json(400, { error }) });

/** The target queue name. Required by every queue-scoped action. */
export function requireQueue(action: ActionPayloadDto): Checked<string> {
  if (typeof action.queue !== 'string' || !action.queue) return invalid('Missing queue');
  return { ok: true, value: action.queue };
}

/** The target instance key. Required by the three instance actions. */
export function requireInstanceKey(action: ActionPayloadDto): Checked<string> {
  if (typeof action.instanceKey !== 'string' || !action.instanceKey) {
    return invalid('Missing instanceKey');
  }
  return { ok: true, value: action.instanceKey };
}

/**
 * The job ids a retry/cancel/remove applies to. `jobIds` (a bulk selection) and `jobId` (one row
 * action) are the same operation at different sizes, so both normalize to a list here rather than
 * taking separate paths through the handler.
 */
export function requireJobIds(action: ActionPayloadDto): Checked<string[]> {
  const ids = action.jobIds?.length ? action.jobIds : action.jobId ? [action.jobId] : [];
  return checkIds(ids, 'jobId(s)');
}

/** The schedule ids a removal applies to — same one-or-many normalization as the job ids. */
export function requireScheduleIds(action: ActionPayloadDto): Checked<string[]> {
  const ids = action.scheduleIds?.length
    ? action.scheduleIds
    : action.scheduleId
      ? [action.scheduleId]
      : [];
  return checkIds(ids, 'scheduleId(s)');
}

/** One schedule id, for the actions that address exactly one. */
export function requireScheduleId(action: ActionPayloadDto): Checked<string> {
  if (typeof action.scheduleId !== 'string' || !action.scheduleId) {
    return invalid('Missing scheduleId');
  }
  return { ok: true, value: action.scheduleId };
}

/**
 * A non-empty id list within core's batch cap.
 *
 * Checked here as well as in core so an oversized selection is a 400 that names the limit rather
 * than a driver error an operator has to interpret. The client stops a selection growing past the
 * same cap, so reaching this means a hand-made request.
 */
function checkIds(ids: string[], what: string): Checked<string[]> {
  if (!ids.length) return invalid(`Missing ${what}`);
  if (ids.length > MAX_BATCH_IDS) {
    return invalid(`Too many ids: ${ids.length} — the limit is ${MAX_BATCH_IDS} per request`);
  }
  return { ok: true, value: ids };
}
