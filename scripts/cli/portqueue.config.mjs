/**
 * Dev config for the local CLI (scripts/cli/run.sh). Uses PGLite with a file-backed data
 * directory so state persists between invocations — no external database required. This is
 * dev-only; real apps export their own configured PortQueue from portqueue.config.{js,mjs}.
 */
import { fileURLToPath } from 'node:url';
import { PortQueue } from '@portqueue/core';
import { PgliteDriver } from '@portqueue/core/drivers/pglite';

const dataDir = fileURLToPath(new URL('./.data', import.meta.url));

export default new PortQueue({ driver: new PgliteDriver({ dataDir }) });
