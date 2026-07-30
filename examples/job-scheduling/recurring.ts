/**
 * Recurring jobs — `schedule.startEverySeconds` (fixed interval) and `schedule.cron`.
 *
 * Run with: `npm run example:schedule-recurring` (from the repo root) or `npm run recurring` here.
 * It waits until each recurrence has fired at least 3 times (~15s), unschedules both and exits.
 * Ctrl+C stops it earlier.
 *
 * A recurring `addJob` creates/updates a recurring producer; `data` + the job options become the
 * template for every produced run. Backed by PGLite under the repo-root `tmp/` folder, so there's
 * no external database to install or start.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PORTQUEUE_DATA_DIR ?? resolve(here, '../..', 'tmp/portqueue-example-scheduling');

type QueueName = 'healthchecks' | 'reports';

/** How many runs of each recurrence to wait for before shutting down. */
const TARGET_RUNS = 3;
/** Give up waiting after this long, so a stuck example can never hang a terminal (or CI). */
const DEADLINE_MS = 60_000;

async function main(): Promise<void> {
  // The scheduler materializes due runs on the client tick (default every 5s), so a recurrence can
  // only be as precise as that tick. Dropping it to 1s here lets the 3s interval below land on
  // time; leave it at the default for production, where a few seconds of drift is fine.
  const pq = new PortQueue<QueueName>({
    driver: new PgliteDriver({ dataDir }),
    tickIntervalSeconds: 1, // tick cadence in seconds
  });
  await pq.init();

  // Count the runs of each recurrence, and resolve once both have fired TARGET_RUNS times.
  const runs: Record<QueueName, number> = { healthchecks: 0, reports: 0 };
  let markRun: (queue: QueueName) => void = () => {};
  const sawEnoughRuns = new Promise<void>((resolveWhenDone) => {
    markRun = (queue) => {
      runs[queue] += 1;
      if (runs.healthchecks >= TARGET_RUNS && runs.reports >= TARGET_RUNS) resolveWhenDone();
    };
  });

  pq.createQueue<Record<string, never>>({ name: 'healthchecks' });
  pq.createWorker<Record<string, never>>({
    queue: 'healthchecks',
    handler: async () => {
      markRun('healthchecks');
      console.log(`💓 [${new Date().toISOString()}] healthcheck (run ${runs.healthchecks})`);
    },
  });

  pq.createQueue<{ kind: string }>({ name: 'reports' });
  pq.createWorker<{ kind: string }>({
    queue: 'reports',
    handler: async (job) => {
      markRun('reports');
      console.log(
        `📊 [${new Date().toISOString()}] building ${job.data.kind} report (run ${runs.reports})`,
      );
    },
  });

  // Fixed interval: every 3 seconds. An `idempotencyKey` keeps exactly one schedule even if this
  // script is run repeatedly against the same (persisted) database.
  const healthcheckSchedule = await pq.addJob({
    queue: 'healthchecks',
    data: {},
    schedule: { startEverySeconds: 3 }, // interval in seconds
    idempotencyKey: 'healthcheck-every-3s',
  });

  // Cron: the 6-field form with a leading seconds field, here every 5 seconds so the example
  // finishes quickly. Standard 5-field expressions work too ('* * * * *' = top of every minute).
  // Cron fields are evaluated in UTC.
  const reportSchedule = await pq.addJob({
    queue: 'reports',
    data: { kind: 'sales' },
    schedule: { cron: '*/5 * * * * *' },
    idempotencyKey: 'sales-report-every-5s',
  });

  // A recurring add returns a `scheduleId` (`AddJobResult` is one shape for both modes, so the
  // field is optional in the type — it's always set for a recurring add). Persist it somewhere
  // durable (your own DB, config, etc.) if you might ever want to stop new runs being spawned for
  // this interval/cron later — that's the id you pass to `pq.removeSchedule({ scheduleId })`.
  const healthcheckScheduleId = healthcheckSchedule.scheduleId;
  const reportScheduleId = reportSchedule.scheduleId;
  if (!healthcheckScheduleId || !reportScheduleId) {
    throw new Error('Expected both recurring adds to return a scheduleId.');
  }
  console.log('Schedule ids (save these to unschedule later):', {
    healthcheck: healthcheckScheduleId,
    salesReport: reportScheduleId,
  });

  console.log(
    `Scheduled: healthcheck every 3s, sales report every 5s. ` +
      `Waiting for ${TARGET_RUNS} runs of each (Ctrl+C to stop earlier)…\n`,
  );

  let stopped = false;
  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    console.log('\nShutting down…');
    await pq.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // PortQueue's own timers are `unref`'d, so the library never holds a process open by itself —
  // this deadline timer is what keeps the event loop alive while we wait for the runs to land.
  let deadline: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    sawEnoughRuns.then(() => false),
    new Promise<boolean>((r) => {
      deadline = setTimeout(() => r(true), DEADLINE_MS);
    }),
  ]);
  if (deadline) clearTimeout(deadline);

  if (timedOut) {
    console.log(
      `\n⚠️  Gave up after ${DEADLINE_MS / 1000}s with ` +
        `${runs.healthchecks} healthcheck / ${runs.reports} report runs.`,
    );
  } else {
    console.log(`\n✅ Saw ${TARGET_RUNS} runs of each recurrence.`);
  }

  // Stop new runs being spawned — this is what the saved `scheduleId` is for. Removing them also
  // leaves the persisted database clean for the next run of this example.
  // Removal is by id alone — the schedule row carries its own queue.
  await pq.removeSchedule({ scheduleId: healthcheckScheduleId });
  await pq.removeSchedule({ scheduleId: reportScheduleId });
  console.log('Unscheduled both recurrences.');

  await shutdown();
}

void main();
