import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import type { PortQueue } from '@portqueue/core';
import { CliError } from './errors.js';

const CONFIG_NAMES = [
  'portqueue.config.ts',
  'portqueue.config.js',
  'portqueue.config.mjs',
  'portqueue.config.cjs',
];

/**
 * Loads the user's own PortQueue instance from a config module. The CLI
 * never builds its own instance from a connection string — it uses exactly what the app
 * configures (driver, options, in-memory defaults). Errors early with an actionable message.
 */
export async function loadPortQueue(options: {
  configPath?: string;
  exportName?: string;
}): Promise<{ pq: PortQueue; loadedFrom: string }> {
  const path = options.configPath ? resolve(options.configPath) : discoverConfig(process.cwd());
  if (!path) {
    throw new CliError(
      `No PortQueue config found. Create a 'portqueue.config.{ts,js,mjs,cjs}' that default-exports a PortQueue ` +
        `(or a factory), or pass --config <path>.`,
    );
  }
  if (path.endsWith('.ts')) {
    throw new CliError(
      `Cannot load a TypeScript config ('${path}') directly — the CLI ships no TS compiler. ` +
        `Run the CLI under a loader (e.g. \`node --import tsx node_modules/@portqueue/cli/dist/cli.mjs ...\`) ` +
        `or point --config at a prebuilt .js file.`,
    );
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  } catch (err) {
    throw new CliError(`Failed to load config '${path}': ${(err as Error).message}`);
  }

  const exportName = options.exportName ?? 'default';
  const value = mod[exportName];
  if (!value) throw new CliError(`Config '${path}' has no export named '${exportName}'.`);

  const resolved =
    typeof value === 'function' ? await (value as () => Promise<PortQueue>)() : value;
  const pq = resolved as PortQueue;
  if (typeof (pq as { init?: unknown }).init !== 'function') {
    throw new CliError(`Export '${exportName}' from '${path}' is not a PortQueue instance.`);
  }
  return { pq, loadedFrom: path };
}

function discoverConfig(start: string): string | null {
  let dir = start;
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
