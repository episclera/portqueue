/**
 * Every default value the tool applies, in one folder, split by scope. A default is defined once
 * here and imported at its use site — never inlined — so changing a policy is a single edit and two
 * files can never disagree about what "the heartbeat window" is.
 *
 * Naming: every export is `DEFAULT_*` when it is a caller-overridable default, and an unprefixed
 * SCREAMING_CASE name when it is a fixed internal bound (a batch size, a scan cap, a multiplier).
 */
export * from './time.constants';
export * from './worker.constants';
export * from './paging.constants';
export * from './maintenance.constants';
export * from './job.constants';
export * from './storage.constants';
