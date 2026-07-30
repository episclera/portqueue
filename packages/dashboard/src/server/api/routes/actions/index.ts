/**
 * The action registry. One entry per mutation, each defined in its own file.
 *
 * Dispatch is a `Map` lookup on {@link ActionKind}, so an unknown kind is a miss rather than a
 * fall-through, and adding an action is adding a file plus one line here. Same shape as the CLI's
 * command registry, for the same reason: the list *is* the documentation of what the API can do.
 */
import { addAction } from './add';
import { cancelAction } from './cancel';
import { pauseAction } from './pause';
import { pauseInstanceAction } from './pause-instance';
import { removeAction } from './remove';
import { removeInstanceAction } from './remove-instance';
import { removeQueueAction } from './remove-queue';
import { removeScheduleAction } from './remove-schedule';
import { resumeAction } from './resume';
import { resumeInstanceAction } from './resume-instance';
import { retryAction } from './retry';
import { setScheduleEnabledAction } from './set-schedule-enabled';
import type { ActionKind } from '../../../../shared/dto';
import type { ActionRoute } from './types';

export const ACTIONS: readonly ActionRoute[] = [
  // Job-scoped (one id or many — the same single-statement batch either way)
  retryAction,
  cancelAction,
  removeAction,
  addAction,
  // Queue-scoped
  pauseAction,
  resumeAction,
  removeQueueAction,
  // Schedule-scoped (they resolve their own queue from the id)
  removeScheduleAction,
  setScheduleEnabledAction,
  // Instance-scoped (queue-less)
  pauseInstanceAction,
  resumeInstanceAction,
  removeInstanceAction,
];

export const ACTIONS_BY_KIND: ReadonlyMap<ActionKind, ActionRoute> = new Map(
  ACTIONS.map((action) => [action.kind, action]),
);

export type { ActionContext, ActionRoute } from './types';
