# Graceful shutdown

Shows `pq.shutdown({ graceful: true, timeoutMs })`: the client stops claiming new jobs and waits
for in-flight handlers to finish, up to `timeoutMs`. The handler honours `job.signal` (an
`AbortSignal`) so it can bail out promptly if the window is exceeded.

Backed by PGLite under the repo-root `tmp/` folder — nothing external to install or start.

```bash
npm run example:graceful         # from the repo root
# or, from this folder:
npm start
```
