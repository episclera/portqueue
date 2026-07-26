import { createServer } from 'node:http';
import { flagNumber, flagString } from '../args';
import { createBasicAuthGuard } from '../basic-auth';
import { CliError } from '../errors';
import { success } from '../output';
import { CommandGroup, type Command } from './types';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_BASE_PATH = '/portqueue';

/** `portqueue dashboard --port --root-user --root-password [--host --base-path]` */
export const dashboardCommand: Command = {
  name: 'dashboard',
  group: CommandGroup.Operational,
  summary: 'Serve the web dashboard',
  usage: '--port <n> --root-user <u> --root-password <p> [--host <h> --base-path <p>]',
  persistent: true,
  async run({ pq, flags }) {
    const port = flagNumber(flags, 'port') ?? DEFAULT_PORT;
    const user = flagString(flags, 'root-user') ?? process.env.PORTQUEUE_ROOT_USER;
    const password = flagString(flags, 'root-password') ?? process.env.PORTQUEUE_ROOT_PASSWORD;
    if (!user || !password) {
      throw new CliError(
        'The served dashboard requires credentials. Pass --root-user and --root-password ' +
          '(or set PORTQUEUE_ROOT_USER / PORTQUEUE_ROOT_PASSWORD).',
      );
    }

    const basePath = flagString(flags, 'base-path');
    const { createDashboard } = await import('@portqueue/dashboard');
    const dashboard = createDashboard({
      portQueue: pq,
      ...(basePath ? { basePath } : {}),
    });

    // The dashboard package ships no auth of its own — protecting the mount belongs to whatever
    // sits in front of it. `portqueue dashboard` opens the port itself, so the guard is here.
    const guard = createBasicAuthGuard({ username: user, password });
    const handler = dashboard.node();
    const server = createServer((req, res) => {
      if (!guard(req, res)) return; // already answered with a 401 challenge
      if (!handler(req, res)) {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
    const host = flagString(flags, 'host') ?? DEFAULT_HOST;
    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    success(
      `Dashboard serving at http://${host}:${port}${basePath ?? DEFAULT_BASE_PATH} (basic auth).`,
    );
    await new Promise(() => {});
  },
};
