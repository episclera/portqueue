# @portqueue/cli

The command-line tool for monitoring and operating [PortQueue](https://episclera.github.io/portqueue/), and for serving the dashboard.

```bash
npm install -D @portqueue/cli
```

It builds its own short-lived, **headless** client from `--driver`/`--connection-string` (or `DATABASE_URL`): it declares no queues, registers no instance row, and consumes no queue or scheduler, so an admin command never joins the cluster it is inspecting.

```bash
portqueue stats --watch
portqueue queues
portqueue jobs --queue emails --status FAILED
portqueue add --queue emails --data '{"to":"a@b.com"}'
portqueue retry --id <jobId> --from failed
portqueue pause --queue emails --mode processing
portqueue listen                       # stream events infinitely
portqueue dashboard --port 4321 --root-user admin --root-password ****
```

Run `portqueue --help` for the full command list. **MIT** — free for commercial use, no obligations.
