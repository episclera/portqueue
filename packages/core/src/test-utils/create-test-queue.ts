import { PortQueue } from '../port-queue';
import { PgliteDriver } from '../drivers/pglite/index';
import { SqliteDriver } from '../drivers/sqlite/index';
import { NoopLogger } from '../logging/console-logger';
import { FakeClock } from '../util/clock';
import type { Driver } from '../drivers/driver.interface';
import type { PortQueueOptions } from '../options/client-options';

export type TestEngine = 'pglite' | 'sqlite';

/** Both test engines, for parameterized suites. */
export const TEST_ENGINES: TestEngine[] = ['pglite', 'sqlite'];

export function createDriver(engine: TestEngine): Driver {
  return engine === 'pglite' ? new PgliteDriver() : new SqliteDriver({ path: ':memory:' });
}

export interface TestQueueHandle {
  pq: PortQueue;
  clock: FakeClock;
  driver: Driver;
  cleanup(): Promise<void>;
}

/**
 * Spin up a clean in-memory PortQueue on the chosen test driver.
 * Uses a FakeClock and a very fast tick, with the system monitor disabled.
 */
export async function createTestQueue(
  engine: TestEngine,
  options: Partial<PortQueueOptions> = {},
): Promise<TestQueueHandle> {
  const clock = new FakeClock(1_700_000_000_000);
  const driver = createDriver(engine);
  const pq = new PortQueue({
    driver,
    logger: new NoopLogger(),
    monitor: false,
    clock,
    tickIntervalMs: 50,
    ...options,
  });
  await pq.init();
  return {
    pq,
    clock,
    driver,
    cleanup: async () => {
      await pq.shutdown({ graceful: false, timeoutMs: 0 });
    },
  };
}

/** Await a condition, polling briefly (for worker-driven behavioral tests). */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}
