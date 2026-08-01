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
  async run({ pq, flags, onExit }) {
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
    // The dashboard builds and owns its own headless client from the driver — it does not ride on
    // the CLI's. Handing it `pq._cli.driver` is the whole of the wiring.
    const dashboard = createDashboard({
      driver: pq._cli.driver,
      ...(basePath ? { basePath } : {}),
    });
    // Registered the moment it exists, so an error later in this function still releases it.
    onExit(() => dashboard.close());

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
    // Before `listen`: a bound port must never outlive the command, and it used to — an error after
    // this point left the server serving 503s from a mount whose client had disconnected.
    onExit(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          // Idle keep-alive sockets would otherwise hold `close` open until they time out.
          server.closeIdleConnections?.();
        }),
    );
    const host = flagString(flags, 'host') ?? DEFAULT_HOST;
    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    success(
      `Dashboard serving at http://${host}:${port}${basePath ?? DEFAULT_BASE_PATH} (basic auth).`,
    );
    // Held open until a stop signal; the runner closes the server, the dashboard and the client.
    await new Promise(() => {});
  },
};
