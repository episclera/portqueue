import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPortQueue } from './config-loader';

function writeConfig(contents: string, name = 'portqueue.config.mjs'): string {
  const dir = mkdtempSync(join(tmpdir(), 'pq-cfg-'));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe('loadPortQueue', () => {
  it('refuses a TypeScript config (no compiler shipped)', async () => {
    await expect(loadPortQueue({ configPath: '/nope/portqueue.config.ts' })).rejects.toThrow(
      /Cannot load a TypeScript config/,
    );
  });

  it('errors when the requested export is missing', async () => {
    const path = writeConfig('export const other = {};');
    await expect(loadPortQueue({ configPath: path })).rejects.toThrow(/no export named 'default'/);
  });

  it('errors when the export is not a PortQueue instance', async () => {
    const path = writeConfig('export default { nope: true };');
    await expect(loadPortQueue({ configPath: path })).rejects.toThrow(/not a PortQueue instance/);
  });

  it('loads a default export that looks like a PortQueue', async () => {
    const path = writeConfig('export default { init() {}, isRunning: false };');
    const { pq, loadedFrom } = await loadPortQueue({ configPath: path });
    expect(typeof (pq as { init: unknown }).init).toBe('function');
    expect(loadedFrom).toBe(path);
  });

  it('invokes a factory export and uses its result', async () => {
    const path = writeConfig('export default () => ({ init() {} });');
    const { pq } = await loadPortQueue({ configPath: path });
    expect(typeof (pq as { init: unknown }).init).toBe('function');
  });

  it('honors a custom --export name', async () => {
    const path = writeConfig('export const app = { init() {} };');
    const { pq } = await loadPortQueue({ configPath: path, exportName: 'app' });
    expect(typeof (pq as { init: unknown }).init).toBe('function');
  });
});
