/**
 * Field checks shared by the action routes.
 *
 * Each returns either the value or a ready-made 400, so a handler reads as a short list of
 * requirements followed by the one call that does the work. A `400` is always the client's mistake:
 * anything core refuses for a legitimate request is a 409 (see `conflict`) or a 400 with core's own
 * message.
 */
import { json, type HandlerResult } from '../../http';
import type { ActionRequestDto } from '../../../../shared/dto';

/** Either a validated value, or the response to send instead. */
export type Checked<T> = { ok: true; value: T } | { ok: false; response: HandlerResult };

const invalid = (error: string): Checked<never> => ({ ok: false, response: json(400, { error }) });

/** The target queue name. Required by every queue- and job-scoped action. */
export function requireQueue(action: ActionRequestDto): Checked<string> {
  if (typeof action.queue !== 'string' || !action.queue) return invalid('Missing queue');
  return { ok: true, value: action.queue };
}

/** The target instance key. Required by the three instance actions. */
export function requireInstanceKey(action: ActionRequestDto): Checked<string> {
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
export function requireJobIds(action: ActionRequestDto): Checked<string[]> {
  const ids = action.jobIds?.length ? action.jobIds : action.jobId ? [action.jobId] : [];
  if (!ids.length) return invalid('Missing jobId(s)');
  return { ok: true, value: ids };
}

/** The schedule ids a removal applies to — same one-or-many normalization as the job ids. */
export function requireScheduleIds(action: ActionRequestDto): Checked<string[]> {
  const ids = action.scheduleIds?.length
    ? action.scheduleIds
    : action.scheduleId
      ? [action.scheduleId]
      : [];
  if (!ids.length) return invalid('Missing scheduleId(s)');
  return { ok: true, value: ids };
}

/** One schedule id, for the actions that address exactly one. */
export function requireScheduleId(action: ActionRequestDto): Checked<string> {
  if (typeof action.scheduleId !== 'string' || !action.scheduleId) {
    return invalid('Missing scheduleId');
  }
  return { ok: true, value: action.scheduleId };
}
