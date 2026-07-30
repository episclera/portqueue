# dashboard-express

Mount the [`@portqueue/dashboard`](../../packages/dashboard) as Express middleware, next to your
own routes. Backed by PGLite (file-backed under the repo-root `tmp/`), so there's no database to
install.

```bash
npm run example:dashboard-express   # from the repo root
# or, from this folder:
npm start
```

The root script rebuilds `@portqueue/core` and `@portqueue/dashboard` before starting, so the UI
you open is built from the current working tree (`PORTQUEUE_SKIP_BUILD=1` skips it).

Then open **http://127.0.0.1:4322/portqueue** (and `/` for the app's own route).

The process names itself with `instance: { instanceKey: 'express-example-1' }`, which registers it
as an instance so the dashboard's **Instances** page has a row — start a second copy with
`PORTQUEUE_INSTANCE_KEY=express-example-2` to watch two servers side by side.

The key wiring is one line — `dashboard.express()` is ordinary `(req, res, next)` middleware that
owns only its base path and falls through to your routes otherwise:

```ts
const dashboard = createDashboard({ driver });
app.use(dashboard.express());
```
