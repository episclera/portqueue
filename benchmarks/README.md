# PortQueue benchmarks

Head-to-head comparisons between PortQueue and other Node.js job queues. Each folder is one
comparison and a workspace package, so it runs `@portqueue/core` **from this repository's working
tree**, never a published release.

| Comparison | Engine | Scenarios |
| --- | --- | --- |
| [`portqueue_vs_pgboss`](./portqueue_vs_pgboss) | PGLite (in-memory) | Adding jobs (single + batch), processing throughput, pickup latency |

## Running

From the repo root — the launcher builds `@portqueue/core` first, runs the comparison, and refreshes
every chart (the comparison's README, the docs Benchmarks page and the summary chart on the repo
README and docs homepage):

```bash
npm run benchmark:portqueue-vs-pgboss
```

The launcher scripts live in [`scripts/benchmarks`](../scripts/benchmarks), one per comparison.
Results and methodology: the [Benchmarks docs page](https://episclera.github.io/portqueue/docs/benchmarks).

## Adding a comparison

1. Copy `portqueue_vs_pgboss/` to `portqueue_vs_<name>/` and swap `src/libs/pgboss.ts` for an
   adapter implementing `Contender` (`src/contender.ts`). Keep the scenarios unchanged so the
   numbers stay comparable.
2. Give it its own docs data file (`docs/src/data/benchmarks/<folder>.json`). The summary chart
   picks it up automatically.
3. Add `scripts/benchmarks/<folder>.sh`, a `benchmark:*` script in the root `package.json`, a row
   above, and a section on `docs/docs/benchmarks.mdx`.
