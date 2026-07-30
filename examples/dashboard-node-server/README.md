# dashboard-node-server

Serve the [`@portqueue/dashboard`](../../packages/dashboard) from a plain `node:http` server.
Backed by PGLite (file-backed under the repo-root `tmp/`), so there's no database to install.

```bash
npm run example:dashboard-node   # from the repo root
# or, from this folder:
npm start
```

Then open **http://127.0.0.1:4321/portqueue**.

The root script rebuilds `@portqueue/core` and `@portqueue/dashboard` before starting, so the UI
you open is built from the current working tree (`PORTQUEUE_SKIP_BUILD=1` skips it).

The example seeds a couple of `emails` jobs (immediate + one delayed) and a recurring `reports`
schedule so the dashboard has live data to display, with a worker draining each queue.

The process names itself with `instance: { instanceKey: 'node-example-1' }`, which registers it as
an instance so the dashboard's **Instances** page has a row — start a second copy with
`PORTQUEUE_INSTANCE_KEY=node-example-2` to watch two servers side by side.

The key wiring is:

```ts
const dashboard = createDashboard({ driver });
const handler = dashboard.node();               // (req, res) => boolean
createServer((req, res) => {
  if (handler(req, res)) return;                // dashboard served it
  res.statusCode = 404;
  res.end('Not found');
}).listen(4321);
```
