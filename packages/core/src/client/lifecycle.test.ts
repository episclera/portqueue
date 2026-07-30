import { PortQueue } from '../port-queue';
import { createDriver, TEST_ENGINES } from '../test-utils/create-test-queue';
import { NoopLogger } from '../logging/console-logger';
import { FakeClock } from '../util/clock';
import { ShutdownTimeoutError } from '../errors/errors';
import type { Driver, JobRef } from '../drivers/driver.interface';

/** A promise plus the function that settles it, so a test can hold a driver call open. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

describe.each(TEST_ENGINES)('client shutdown (%s)', (engine) => {
  /**
   * The maintenance tick is fired without an await, so shutdown has to wait for it: an engine
   * that lives in this process (PGLite) faults when its memory is torn down mid-query.
   */
  it('waits for an in-flight maintenance tick before disconnecting the driver', async () => {
    const driver = createDriver(engine);
    const held = gate();
    let disconnected = false;
    let queriedAfterDisconnect = false;

    const expireDueJobs = driver.expireDueJobs.bind(driver);
    driver.expireDueJobs = async (options: {
      queueName?: string;
      limit: number;
      now: number;
    }): Promise<JobRef[]> => {
      await held.wait;
      if (disconnected) queriedAfterDisconnect = true;
      return expireDueJobs(options);
    };
    const disconnect = driver.disconnect.bind(driver);
    driver.disconnect = async (): Promise<void> => {
      disconnected = true;
      await disconnect();
    };

    const pq = newClient(driver);
    await pq.init(); // ends with an immediate tick, now parked in expireDueJobs
    const stopping = pq.shutdown();
    await flush();
    expect(disconnected).toBe(false); // still waiting on the tick

    held.open();
    await stopping;
    expect(disconnected).toBe(true);
    expect(queriedAfterDisconnect).toBe(false);
  });

  it('gives up on background work that outlasts the shutdown timeout, and says so', async () => {
    const driver = createDriver(engine);
    const held = gate();
    const expireDueJobs = driver.expireDueJobs.bind(driver);
    driver.expireDueJobs = async (options: {
      queueName?: string;
      limit: number;
      now: number;
    }): Promise<JobRef[]> => {
      await held.wait;
      return expireDueJobs(options);
    };

    const pq = newClient(driver);
    await pq.init();
    // The shutdown still completes — the driver is disconnected and the client is stopped — but it
    // reports that it abandoned work rather than letting a half-finished stop look clean.
    await expect(pq.shutdown({ graceful: false, timeoutSeconds: 0.025 })).rejects.toThrow(
      ShutdownTimeoutError,
    );
    expect(pq.isRunning).toBe(false);

    // Release the parked call so it doesn't outlive the test; it fails harmlessly on the
    // disconnected driver and the tick swallows it.
    held.open();
    await flush();
  });

  it('resolves quietly when everything settles inside the timeout', async () => {
    const pq = newClient(createDriver(engine));
    await pq.init();
    await expect(pq.shutdown()).resolves.toBeUndefined();
    expect(pq.isRunning).toBe(false);
  });
});

function newClient(driver: Driver): PortQueue {
  return new PortQueue({
    driver,
    logger: new NoopLogger(),
    clock: new FakeClock(1_700_000_000_000),
    tickIntervalSeconds: 0.05,
  });
}

/** Let every already-queued microtask/timer callback run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
