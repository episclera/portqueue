# dashboard-node-server

Serve the [`@portqueue/dashboard`](../../packages/dashboard) from a plain `node:http` server.
Backed by PGLite (file-backed under the repo-root `tmp/`), so there's no database to install.

```bash
npm run example:dashboard-node   # from the repo root
# or, from this folder:
npm start
```

Then open **http://127.0.0.1:4321/portqueue**.

The example seeds a couple of `emails` jobs (immediate + one delayed) and a recurring `reports`
schedule so the dashboard has live data to display, and runs a worker that drains the `emails`
queue.

The key wiring is:

```ts
const dashboard = createDashboard({ portQueue: pq });
const handler = dashboard.node();               // (req, res) => boolean
createServer((req, res) => {
  if (handler(req, res)) return;                // dashboard served it
  res.statusCode = 404;
  res.end('Not found');
}).listen(4321);
```
