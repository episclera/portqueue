# @portqueue/cli

The command-line tool for monitoring and operating [PortQueue](https://episclera.github.io/portqueue/), and for serving the dashboard.

```bash
npm install -D @portqueue/cli
```

It loads **your** `PortQueue` instance from a `portqueue.config.{js,mjs,cjs}` (or `--config <path>`) — it never builds its own connection.

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
