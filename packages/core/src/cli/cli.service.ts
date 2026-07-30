/**
 * The `pq._cli` facade — everything `@portqueue/cli` needs that the public API deliberately does
 * not offer. Nothing here is a documented developer API (the `_` prefix on the property says so);
 * it exists so a CLI requirement never forces a change to `PortQueue`. See CLAUDE.md.
 *
 * The CLI's distinguishing constraint is that it is an **admin process that never owns the app's
 * queues**: it runs on a headless client (see `PortQueueOptions._headless`), so it declares nothing,
 * registers no instance row, and addresses every queue by name against the driver.
 */
import { JobStatus } from '../jobs/job-state.enum';
import { InvalidOptionsError } from '../errors/errors';
import { pageWindow } from '../monitoring/stats.service';
import { latestVersion } from '../drivers/shared/migration';
import type { Runtime } from '../client/runtime';
import type { Driver } from '../drivers/driver.interface';
import type { Page, ScheduleInfo } from '../producer/results';
import type { ProducerService } from '../producer/producer.service';
import type { TransactionHandle } from '../tx/transaction-handle';

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
  constructor(
    private readonly runtime: Runtime,
    private readonly producer: ProducerService,
  ) {}

  /** The live driver, for CLI paths that need engine detail the public API doesn't expose. */
  get driver(): Driver {
    return this.runtime.driver;
  }

  runInTransaction<T>(options: { fn: (tx: TransactionHandle) => Promise<T> }): Promise<T> {
    return this.runtime.driver.runInTransaction(options);
  }

  /**
   * A **page** of schedules — one queue's, or across every queue when `queue` is omitted.
   *
   * Paged like every other list path. This used to call `listSchedules` with no window at all, so
   * `portqueue schedules` loaded every schedule row in the database into the terminal.
   */
  getSchedules(
    options: { queue?: string; limit?: number; offset?: number } = {},
  ): Promise<Page<ScheduleInfo>> {
    const { limit, offset } = pageWindow(options);
    return this.producer.getSchedules({
      ...(options.queue ? { queue: options.queue } : {}),
      limit,
      offset,
    });
  }

  /**
   * Delete every job on a queue in the given states (`portqueue purge`). Addresses the queue by
   * name, so purging never declares it. ACTIVE is refused for the same reason the public path
   * refuses it: the row belongs to a running handler.
   */
  async purge(options: { queue: string; statuses: JobStatus[] }): Promise<number> {
    if (options.statuses.includes(JobStatus.ACTIVE)) {
      throw new InvalidOptionsError(
        `Cannot purge ACTIVE jobs on queue '${options.queue}': an ACTIVE job is running. ` +
          `Cancel it first, then purge once it has settled.`,
        { queue: options.queue },
      );
    }
    return this.runtime.driver.removeJobsByStatus({
      queueName: options.queue,
      statuses: options.statuses,
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
    return {
      engine: driver.engine,
      serverVersion: probe.serverVersion,
      verifiedCapabilities: probe.verifiedCapabilities.map(String),
      schemaVersion,
      latestVersion: latestVersion(driver.migrations),
      queueCount,
      instanceCount,
    };
  }
}
