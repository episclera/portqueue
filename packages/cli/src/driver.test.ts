import { buildPortQueue, CliEngine } from './driver';
import { CliError } from './errors';

describe('buildPortQueue', () => {
  it('builds an in-memory sqlite instance from --driver sqlite', async () => {
    const pq = await buildPortQueue({ driver: 'sqlite' });
    expect(typeof (pq as { init: unknown }).init).toBe('function');
    await pq.init();
    expect(pq.isRunning).toBe(true);
    await pq.shutdown();
  });

  it('infers postgres from a postgres:// connection string', async () => {
    // Construction is pure DI — no connection is opened until init(), so this stays offline.
    const pq = await buildPortQueue({
      connectionString: 'postgres://user:pass@localhost:5432/db',
    });
    expect(typeof (pq as { init: unknown }).init).toBe('function');
  });

  it('rejects an unknown --driver', async () => {
    await expect(buildPortQueue({ driver: 'mongo' })).rejects.toThrow(CliError);
    await expect(buildPortQueue({ driver: 'mongo' })).rejects.toThrow(/Unknown --driver/);
  });

  it('errors when the engine cannot be determined', async () => {
    await expect(buildPortQueue({})).rejects.toThrow(/Cannot determine the database engine/);
  });

  it('errors when a server engine has no connection string', async () => {
    await expect(buildPortQueue({ driver: 'postgresql' })).rejects.toThrow(
      /needs a connection string/,
    );
  });

  it('exposes the engine enum values used by --driver', () => {
    expect(CliEngine.POSTGRESQL).toBe('postgresql');
    expect(CliEngine.SQLITE).toBe('sqlite');
    expect(CliEngine.PGLITE).toBe('pglite');
    expect(CliEngine.MYSQL).toBe('mysql');
    expect(CliEngine.ORACLE).toBe('oracle');
  });
});
