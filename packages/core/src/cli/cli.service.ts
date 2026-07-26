/**
 * The `pq._cli` facade — everything `@portqueue/cli` needs that the public API deliberately does
 * not offer. Nothing here is a documented developer API (the `_` prefix on the property says so);
 * it exists so a CLI requirement never forces a change to `PortQueue`. See CLAUDE.md.
 *
 * The CLI's distinguishing constraint is that it is an **admin process that never owns the app's
 * queues**. Calling `createQueue` to reach a queue-scoped method would register that queue in the
 * CLI's own process — harmless while the CLI is short-lived, but it makes `inUse` and the
 * `removeQueue` guard mean the wrong thing. Everything here therefore addresses queues by name
 * against the driver instead.
 */
import { PortQueueEvent } from '../events/event-name.enum';
import { JobStatus } from '../jobs/job-state.enum';
import { InvalidOptionsError } from '../errors/errors';
import type { Runtime } from '../client/runtime';
import type { Driver } from '../drivers/driver.interface';
import type { ScheduleInfo } from '../producer/results';
import type { TransactionHandle } from '../tx/transaction-handle';

/** A schedule plus the queue it belongs to, as the `schedules` command prints it. */
export interface CliSchedule extends ScheduleInfo {
  queue: string;
}

/** What `portqueue doctor` reports about the connection it just made. */
export interface DoctorReport {
  engine: string;
  serverVersion: string;
  /** Capabilities the driver verified against the live server, not just the ones it declares. */
  verifiedCapabilities: string[];
  /** The applied schema version, or null when the schema has never been migrated. */
  schemaVersion: number | null;
  /** The highest version this driver ships; equal to `schemaVersion` when fully migrated. */
  latestVersion: number;
  queueCount: number;
  instanceCount: number;
}

export class CliService {
  constructor(private readonly runtime: Runtime) {}

  /** The live driver, for CLI paths that need engine detail the public API doesn't expose. */
  get driver(): Driver {
    return this.runtime.driver;
  }

  runInTransaction<T>(options: { fn: (tx: TransactionHandle) => Promise<T> }): Promise<T> {
    return this.runtime.driver.runInTransaction(options);
  }

  /**
   * Schedules for one queue, or across every queue when `queue` is omitted — read straight from
   * the driver, so listing them never registers a queue in the CLI's process (which the public
   * `queue.getSchedules()` would, since it needs a `Queue` handle).
   */
  async getSchedules(options: { queue?: string } = {}): Promise<CliSchedule[]> {
    const rows = await this.runtime.driver.listSchedules(
      options.queue ? { queueName: options.queue } : {},
    );
    return rows.map((s) => ({
      scheduleId: s.id,
      queue: s.queueName,
      cron: s.cron,
      everySeconds: s.everySeconds,
      timezone: s.timezone,
      nextRunAt: s.nextRunAt != null ? new Date(s.nextRunAt) : null,
      lastRunAt: s.lastRunAt != null ? new Date(s.lastRunAt) : null,
      enabled: s.enabled,
      idempotencyKey: s.idempotencyKey,
    }));
  }

  /**
   * Remove a schedule by id alone. The public API removes one through a `Queue` handle, which
   * forces the caller to already know the queue; the CLI's `remove --schedule-id` doesn't.
   */
  async removeSchedule(options: { scheduleId: string }): Promise<boolean> {
    const row = await this.runtime.driver.getSchedule({ scheduleId: options.scheduleId });
    if (!row) return false;
    const ok = await this.runtime.driver.runInTransaction({
      fn: (tx) => this.runtime.driver.deleteSchedule({ scheduleId: options.scheduleId, tx }),
    });
    if (ok) {
      this.runtime.events.emit(PortQueueEvent.SCHEDULE_REMOVED, {
        scheduleId: options.scheduleId,
        queue: row.queueName,
      });
    }
    return ok;
  }

  /**
   * Delete every job on a queue in the given states (`portqueue purge`). Addresses the queue by
   * name rather than through a `Queue` handle, so purging doesn't claim the queue. ACTIVE is
   * refused for the same reason the public path refuses it: the row belongs to a running handler.
   */
  async purge(options: { queue: string; statuses: JobStatus[] }): Promise<number> {
    if (options.statuses.includes(JobStatus.ACTIVE)) {
      throw new InvalidOptionsError(
        `Cannot purge ACTIVE jobs on queue '${options.queue}': an ACTIVE job is running. ` +
          `Cancel it first, then purge once it has settled.`,
        { queue: options.queue },
      );
    }
    return this.runtime.driver.runInTransaction({
      fn: (tx) =>
        this.runtime.driver.removeJobsByStatus({
          queueName: options.queue,
          statuses: options.statuses,
          tx,
        }),
    });
  }

  /**
   * Everything `portqueue doctor` reports: a live probe of the server plus the applied vs shipped
   * schema version. `PortQueue` exposes none of this — `migrate()` applies migrations but never
   * says what state the schema was in.
   */
  async doctor(): Promise<DoctorReport> {
    const driver = this.runtime.driver;
    const [probe, schemaVersion, queueCount, instanceCount] = await Promise.all([
      driver.probe(),
      driver.getSchemaVersion(),
      driver.countQueues(),
      driver.countInstances(),
    ]);
    const latestVersion = driver.migrations.reduce((max, m) => Math.max(max, m.version), 0);
    return {
      engine: driver.engine,
      serverVersion: probe.serverVersion,
      verifiedCapabilities: probe.verifiedCapabilities.map(String),
      schemaVersion,
      latestVersion,
      queueCount,
      instanceCount,
    };
  }
}
