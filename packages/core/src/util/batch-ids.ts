import { MAX_BATCH_IDS } from '../constants';
import { InvalidOptionsError } from '../errors/errors';

/**
 * Refuse a by-id batch larger than one statement can carry.
 *
 * Every batch is a single statement over the whole set (see the batch invariant in CLAUDE.md), and
 * every engine caps the expressions an `IN (...)` list may hold — Oracle at 1000, the lowest of the
 * engines here. Rather than let the limit surface as an engine error on one deployment and work on
 * another, the tool takes the tightest ceiling as everyone's and says so up front.
 *
 * A caller with more than {@link MAX_BATCH_IDS} ids splits them: each slice is one round trip, and
 * partial progress is visible between them, which is what an operator wants from a large removal
 * anyway.
 */
export function assertBatchIds(ids: readonly unknown[], option: string): void {
  if (ids.length > MAX_BATCH_IDS) {
    throw new InvalidOptionsError(
      `'${option}' carries ${ids.length} ids, more than the ${MAX_BATCH_IDS} one batch may take. ` +
        `A batch is a single statement, and ${MAX_BATCH_IDS} is the smallest limit any supported ` +
        `engine puts on an IN list — split the ids and call again.`,
      { count: ids.length, limit: MAX_BATCH_IDS },
    );
  }
}
