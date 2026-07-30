/**
 * Batch sizes for the maintenance work the tick drives. Every sweep is bounded per statement and
 * loops until a short batch, so a backlog is drained across round trips instead of in one
 * table-wide transaction.
 */

/** Rows one retention delete removes. */
export const RETENTION_BATCH_SIZE = 500;

/** How many retention batches one tick will run before leaving the rest to the next tick. */
export const RETENTION_MAX_BATCHES = 20;

/** Due schedules fired per batch. */
export const SCHEDULE_BATCH_SIZE = 100;

/** How many schedule batches one tick will fire before leaving the rest to the next tick. */
export const SCHEDULE_MAX_BATCHES = 20;

/** Rows one `expireDueJobs` / `reclaimStalledJobs` statement touches. */
export const MAINTENANCE_BATCH_SIZE = 500;

/** How many expire/reclaim batches one tick will run. */
export const MAINTENANCE_MAX_BATCHES = 20;
