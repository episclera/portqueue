# dashboard-express

Mount the [`@portqueue/dashboard`](../../packages/dashboard) as Express middleware, next to your
own routes. Backed by PGLite (file-backed under the repo-root `tmp/`), so there's no database to
install.

```bash
npm run example:dashboard-express   # from the repo root
# or, from this folder:
npm start
```

Then open **http://127.0.0.1:4322/portqueue** (and `/` for the app's own route).

The key wiring is one line — `dashboard.express()` is ordinary `(req, res, next)` middleware that
owns only its base path and falls through to your routes otherwise:

```ts
const dashboard = createDashboard({ portQueue: pq });
app.use(dashboard.express());
```
