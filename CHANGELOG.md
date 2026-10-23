# Changelog

## [1.0.1](https://github.com/episclera/portqueue/compare/v1.0.0...v1.0.1) (2026-10-23)

### Documentation

* keep only the root changelog ([01eed86](https://github.com/episclera/portqueue/commit/01eed86fc8539afd068ae74c43bb36163e105fed))

## 1.0.0 (2026-10-23)

### ⚠ BREAKING CHANGES

* **ui,dashboard:** @portqueue/ui no longer exports the styled-components theme objects; it is private, so only in-repo consumers are affected.
* `v1` gains `lock_token` and `retention_statuses` becomes an
integer bitmask, so an existing development database must be dropped.
`cancelJob` returns `CancelOutcome` rather than a boolean and throws for an
unknown id; `completeJob`/`failJob`/`retryJob` return a boolean; the dashboard
action endpoint moved to `/api/actions/<kind>` and mutations require the
`x-requested-with` header; `DASHBOARD_MAX_LIMIT` is gone in favour of
`DASHBOARD_MAX_PAGE_LIMIT`.

MySQL and Oracle have not been re-verified against a real server — see
packages/core/DRIVER-VERIFICATION.md.
* **core:** drop retention_mode and the schedule window columns
* **core:** `MigrationColumn.APPLIED_AT` is removed, and the `pq_migration` table
no longer has an `applied_at` column. A database already stamped at v1 keeps its
`applied_at NOT NULL` column and will reject the new insert — drop and recreate any dev
database and any PGLite data directory.
* `pq.createWorker(...)` is removed — pass `handler`, `limiter`
and `dontAutoretryFor` to `pq.createQueue({ name, ... })` instead. `Worker` and
`WorkerOptions` are no longer exported, `createQueue` now requires a `handler`,
and declaring the same queue twice in one process throws.
* queue.addJob(...) and every other Queue method move to
pq.addJob({ queue, ... }); createDashboard takes { driver } instead of
{ portQueue }; retryJob returns null when it refuses; shutdown() rejects with
ShutdownTimeoutError when it abandons in-flight work; the v1 schema was edited
in place, so existing databases must be dropped.

MySQL and Oracle have no automated coverage — their rewritten SQL still needs a
manual conformance run against a real server.
* **core:** `GetJobsQuery.cursor` and `.order` are removed; page results
no longer carry `cursor` or `hasMore`; `createQueue(name, options?)` is now
`createQueue({ name, ...options })`; `pq.getStats()` is `pq.getQueuesStats()`;
`getQueues`, `getInstances` and `Queue.getSchedules` return a `Page<T>` rather
than an array.
* **core:** the SQLite driver now requires the `better-sqlite3` peer
dependency (a native module) instead of Node's builtin. `npm install
better-sqlite3`. The `fromNodeSqlite` transaction adapter is unaffected.
* **core:** `systemLimiter.resumeHysteresis` no longer exists — remove it.
`maxCpuPercent` is now a 0-100 share of all available cores, so a cap carried
over from the per-core scale must be divided by the core count (`600` on 8
cores becomes `75`). Stored and reported `cpuPercent` values change scale too.
* **core:** cpuPercent can exceed 100 again (100 = one core saturated), so a
maxCpuPercent tuned for the host share now throttles far too early — on a multi-core
box a cap nearer 200-300 is right. memoryPercent is a share of V8's heap limit, not
of machine RAM, so an 85-90 threshold means something quite different. The dashboard
columns and cards read "CPU (process)"/"Memory (process)" and the CLI's read
"CPU (proc)"/"Mem (proc)"; the CPU warn/danger tones move to 80/100. No schema
change: the instance columns are the same two percentages.

Going to Production gains a section on sizing --max-old-space-size, since Node caps
its default heap in the low gigabytes however much RAM the machine has.
* **core:** limiter.maxRssBytes is removed, as is rssBytes from
InstanceInfo/InstanceDto and the rss_bytes column in every engine's v1
migration. cpuPercent can no longer exceed 100. The dashboard's RSS column and
card are gone; the CPU/memory card and column hovers now say the reading is
machine-wide, not the Node process. No new dependency — node:os only.
* systemLimiter replaces monitor, and instances record their own health
* one seconds-only delay option, integer duration columns
* take every duration in seconds and delegate cron to cron-parser
* **dashboard:** `createDashboard()` no longer accepts `title` or `theme`, and
`DashboardConfigDto` carries only `basePath`.
* **dashboard:** `pq._dashboard.getJobs()` no longer accepts `searchScanLimit`
and no longer returns `searchTruncated`; `JobPageDto.searchTruncated` is gone.
* **dashboard:** `DashboardOptions.auth` and `.readOnly` are removed along
with the `DashboardAuth` types and the `/api/events` stream; put the mount
behind your own auth middleware. List endpoints return `{items, total,
hasMore}` instead of bare arrays. `StatsDto` drops `throughputPerMinute`
and `failureRate`. The `purge` action is removed.
* **cli:** `portqueue dashboard --read-only` is removed. `remove
--schedule-id` no longer accepts `--queue`. `stats` no longer prints
throughput or failure rate, and drops both from its `--json` output.
* **core:** removeJob/removeJobs no longer delete an ACTIVE job, and
removeJobs({ statuses }) rejects ACTIVE.
* **core:** an idempotencyKey shared between a one-off job and a recurring
schedule no longer collapses them into one entity.
* **core:** removes workflows, getWorkflow, addJobs, startStep,
UnsupportedForWorkerTypeError, and the WORKFLOW_*/JOB_STEP_COMPLETED events.
* **core:** RetryMode is removed and retryJob no longer accepts 'from'. Replace retryJob({ jobId, from: FROM_START }) with addJob({ data }); retryJob({ jobId, from: FROM_FAILED_STEP }) becomes retryJob({ jobId }).
* **core:** fold cancelRunningJob into cancelJob; docs restructure
* **cli:** connect via --driver/--connection-string, drop config file
* **core:** per-driver storage options; drop instance id, locked_by column, job metadata
* **core:** remove Citus and Yugabyte drivers
* **core:** drop redundant purgeJobs in favour of removeJobs
* **core:** group job/worker/client options and trim redundant settings
* **core:** multi-instance affinity + sharded-friendly schema
* **core:** workflow handler arrays, flat scheduling, drop delay

### Features

* add TODO md ([4db4c2a](https://github.com/episclera/portqueue/commit/4db4c2a088a42d5333d1444f63f125d2fec7b67e))
* **cli:** route commands through pq._cli, own the basic-auth guard ([9132e98](https://github.com/episclera/portqueue/commit/9132e9869d8f089e4476f4bfdb2a539a5653aa69))
* **core:** accept an optional tx on every job-manipulating method ([f438c56](https://github.com/episclera/portqueue/commit/f438c562765d52ec994740fb262c78715948a5f6))
* **core:** add _dashboard and _cli facades, page every list read ([d29ab1c](https://github.com/episclera/portqueue/commit/d29ab1ce92a486fbd6a28836e2ebd64a006453b1))
* **core:** carry all per-job options from a recurring add to spawned jobs ([c9b0dbf](https://github.com/episclera/portqueue/commit/c9b0dbf33662ea1c304b68cc94818304cc336c72))
* **core:** drop workflow support and the addJobs bulk method ([1ee0bb4](https://github.com/episclera/portqueue/commit/1ee0bb4373bdd483c684158f7b6e93cf0bf66908))
* **core:** fold cancelRunningJob into cancelJob; docs restructure ([a232bca](https://github.com/episclera/portqueue/commit/a232bca704cf1e228e57ab02c8c4d9b6fb58d0dd))
* **core:** group job/worker/client options and trim redundant settings ([32852f7](https://github.com/episclera/portqueue/commit/32852f7002155d28be46025df7ed374c129dc423))
* **core:** measure CPU and memory per process again, not per machine ([a7b2a68](https://github.com/episclera/portqueue/commit/a7b2a680fc5c84e8e7fbe49ca7d2b4736832d3bb))
* **core:** multi-instance affinity + sharded-friendly schema ([abf3ef1](https://github.com/episclera/portqueue/commit/abf3ef162665c79d453728a866f5edf4b8253674))
* **core:** never remove a running (ACTIVE) job ([8dd6433](https://github.com/episclera/portqueue/commit/8dd64334416b747e120e0f264b3b64c8dfb24cc0))
* **core:** page every list read with limit/offset and a total ([4c142b1](https://github.com/episclera/portqueue/commit/4c142b194b1ae2218e72f6d8b6b0bafc4e31b1f9))
* **core:** read CPU and memory for the machine, not the process; drop RSS ([c28c405](https://github.com/episclera/portqueue/commit/c28c4055b55cfbdf82acf6fa475e0a87e739bbe1))
* **core:** scale cpuPercent to all available cores; drop resumeHysteresis ([bf133b0](https://github.com/episclera/portqueue/commit/bf133b0ebff84fcbf366091c761164c27631cf64))
* **core:** scope idempotency dedup per entity, not across tables ([997bfbb](https://github.com/episclera/portqueue/commit/997bfbbceaf8a1bca1a83a8720e6e42a3bf4a0e9))
* **core:** workflow handler arrays, flat scheduling, drop delay ([be15385](https://github.com/episclera/portqueue/commit/be15385e8bf6e0a921370d971689f2bad5300358))
* **dashboard,cli:** colour health metrics at 75/85 and poll every 15s ([9d740e1](https://github.com/episclera/portqueue/commit/9d740e18b3dd1924354426668b9077af10ac20b4))
* **dashboard:** drop the title and theme options ([c665cf2](https://github.com/episclera/portqueue/commit/c665cf208c7c189845f0750208f048943897f30b))
* **dashboard:** leave a detail page when its record does ([f4258af](https://github.com/episclera/portqueue/commit/f4258af56a68686eaec738cec0fdb97f6cda8a2b))
* **dashboard:** link jobs to the instance that ran them, and act on an instance from its page ([5cd7efd](https://github.com/episclera/portqueue/commit/5cd7efd186f59ead6f0b002fa0b98ab096d5a317))
* **dashboard:** pick a single filter value from a select ([d1e3aa3](https://github.com/episclera/portqueue/commit/d1e3aa3f7afa2ee4a1700404086535ab616a97c2))
* **dashboard:** rebuild on the core facade; drop SSE, auth and read-only ([71ccb42](https://github.com/episclera/portqueue/commit/71ccb42365277b1481a8aac9890086b86170d24f))
* **dashboard:** sidebar docs/GitHub links, pending counts, action tests ([dccb391](https://github.com/episclera/portqueue/commit/dccb39161d587f32d22d10424543e204754a747b))
* **dashboard:** sidebar shell, shared table cards, numbered pagination ([06c8c22](https://github.com/episclera/portqueue/commit/06c8c226d376952537af942475684c5d7a28a7d5))
* **dashboard:** timing columns on the jobs table, full job record on detail ([ddf1716](https://github.com/episclera/portqueue/commit/ddf1716c21aadfa8f01477d2d32d1f6830a9de6c))
* dedup jobs and schedules by idempotency key, allow identical schedules ([dfe7309](https://github.com/episclera/portqueue/commit/dfe730900bf49cf4703aee26a514b68915582d10))
* **dev:** add local MySQL docker service + scripts; document CLI Dockerfile ([88e7b7a](https://github.com/episclera/portqueue/commit/88e7b7a29df8fdd745ef9026360c431e445910f8))
* fold the consumer into createQueue and rebuild Getting Started ([6eb99f4](https://github.com/episclera/portqueue/commit/6eb99f4f0ed33b069f43d85f213b8521f2cc1138))
* implement PortQueue — core engine, drivers, dashboard, CLI, docs ([7f0cfee](https://github.com/episclera/portqueue/commit/7f0cfee2ddb4af418cf9a71c8591cb469dc05b75))
* initial build plan ([fd058ca](https://github.com/episclera/portqueue/commit/fd058ca3e4be15dc1dae0a4d1e041e8f2d735308))
* pattern-only instance affinity, paginated claim, instance/queue removal ([6c65b79](https://github.com/episclera/portqueue/commit/6c65b7969ac1f755df52016159aeca9899a2c534))
* systemLimiter replaces monitor, and instances record their own health ([b34722e](https://github.com/episclera/portqueue/commit/b34722eba5030a9d5460b0ffe6f84b8e8c8e70c9))
* **ui:** dark-green links/tabs/buttons, opaque header, waveless logo, borderless alerts ([2e61690](https://github.com/episclera/portqueue/commit/2e61690c8c46e6fe75fd2455b14180c903a365cf))
* **ui:** render every floating layer through a body portal ([c27ac2e](https://github.com/episclera/portqueue/commit/c27ac2e3444c261a901b28af1c15a4ed6b9dd5a2))
* **ui:** replace antd with a hand-built @portqueue/ui styled-components library ([4dff89a](https://github.com/episclera/portqueue/commit/4dff89af7762ec72e6b601a5153b807a2d0b17e4))

### Bug Fixes

* add some suggestions in todo ([9257875](https://github.com/episclera/portqueue/commit/92578756a98d63c4c4f26e1db8e0263e2b0f8d91))
* agent instructions ([3590efb](https://github.com/episclera/portqueue/commit/3590efbc4cd1d8d87c694cf7c2c5cf277146a591))
* api ref docs ([e44398b](https://github.com/episclera/portqueue/commit/e44398ba64d014d0d9b6260d35f5efab96a8a498))
* build plan ([340b811](https://github.com/episclera/portqueue/commit/340b811abe932777e527280de7787302408eea25))
* **build:** externalize bare node built-ins, not just the node: form ([a184882](https://github.com/episclera/portqueue/commit/a184882b97135fc8a8594c62e93baf519eeed859))
* cancelling examples ([1d082c5](https://github.com/episclera/portqueue/commit/1d082c52b73a01a71d9ad9d5eb7b8506ebc8acb3))
* change main line ([bbf0871](https://github.com/episclera/portqueue/commit/bbf0871e444c5750e570f9ad449421259c2e73e6))
* ci action ([76291be](https://github.com/episclera/portqueue/commit/76291be760db42a3a096232cafa834ed7d8e7bdb))
* **ci:** build workspaces in dependency order before lint and test ([bc53686](https://github.com/episclera/portqueue/commit/bc53686b88336b6b1027236fea6194717f11051f))
* claude sett ([5815c4f](https://github.com/episclera/portqueue/commit/5815c4f40aeccd6f110ef64659a49ee64b2b5a4e))
* **cli:** drop leading ./ from bin path so npm stops warning on publish ([cbf2cc7](https://github.com/episclera/portqueue/commit/cbf2cc7246a82d5cb126c56a589a14ad8946c06c))
* **core:** drain fire-and-forget work before disconnecting the driver ([a60c624](https://github.com/episclera/portqueue/commit/a60c6248c7375ffe4d7e2fc94e7819266aff3aa5))
* **core:** drive SQLite through better-sqlite3, not node:sqlite ([6e1b980](https://github.com/episclera/portqueue/commit/6e1b98011ab95bc79dbe0d63bd461f82fdb3b857))
* **core:** read a job on the caller's transaction, not beside it ([81c161e](https://github.com/episclera/portqueue/commit/81c161e96486800b8ab5529226d63ecb461e5b81))
* **core:** unify pollInterval default, forward tx by status, export more errors ([1e27d0a](https://github.com/episclera/portqueue/commit/1e27d0a7954a0ba0346bf476d55381a20e6c8716))
* dash todo ([c8f6df3](https://github.com/episclera/portqueue/commit/c8f6df370b32709dbd7afed545da9079df3d5b3e))
* **dashboard:** drop the stalled activity card, which always read zero ([09086be](https://github.com/episclera/portqueue/commit/09086be61fe936fd959897d1c69d5e1c4bbc5c1d))
* **dashboard:** keep a timestamp column wide enough to read ([991197d](https://github.com/episclera/portqueue/commit/991197d5c9ef56267ef97acc0fc46fba3beb8901))
* **dashboard:** never serve a page from the query cache ([8084e64](https://github.com/episclera/portqueue/commit/8084e642b0212597fb920c20c593b94585c79008))
* **dashboard:** search every job, not the most recent 500 ([47241e1](https://github.com/episclera/portqueue/commit/47241e1ab64ff45830a88cde95e9645ef4753c51))
* **dashboard:** serve SPA assets from absolute mount paths ([e289cdb](https://github.com/episclera/portqueue/commit/e289cdb06b0117e9db4ea46e0cf5fdd94b6a2e2b))
* **dashboard:** truncate schedule ids like job ids ([d0b5ab5](https://github.com/episclera/portqueue/commit/d0b5ab5dfd79ba8aaf0a57ab1164101e972081cc))
* **docs:** make the theme switcher a two-state toggle, like the dashboard ([75d154a](https://github.com/episclera/portqueue/commit/75d154a691e11d16790bd266cdf3ef0da61a3046))
* **docs:** repair broken links and heading anchors ([926bd14](https://github.com/episclera/portqueue/commit/926bd14e9aefe6d2a5ad46cd791a4b57072a4dbf)), closes [#choosing-a-preferred-server-with-regex-patterns](https://github.com/episclera/portqueue/issues/choosing-a-preferred-server-with-regex-patterns) [#attach-a-regex-pattern-to-the-job](https://github.com/episclera/portqueue/issues/attach-a-regex-pattern-to-the-job)
* **docs:** style the landing page with CSS Modules so it renders on first load ([ef5d2fa](https://github.com/episclera/portqueue/commit/ef5d2fa015e3ccf6158cd04c2c86396843f45f50))
* **examples:** add a worker for every queue that produces jobs ([332959a](https://github.com/episclera/portqueue/commit/332959a6366f4479bccd47670ba1259fe2dbd4ef))
* improve docs ([e01cc02](https://github.com/episclera/portqueue/commit/e01cc02703d9028496fd215f7926ddf9f38d1f4f))
* instances page docs ([2179d56](https://github.com/episclera/portqueue/commit/2179d565cc198a5e4d5984583723c2c8673077d9))
* maybe rm fallback insatnce key ([3660ea0](https://github.com/episclera/portqueue/commit/3660ea0d1c46136e4cb52094a158adfaf4774339))
* multi db todo ([7b5f911](https://github.com/episclera/portqueue/commit/7b5f91112742b8f459f2866b60f9a586fedcfaf7))
* new dsh photos ([f946a63](https://github.com/episclera/portqueue/commit/f946a633c05df6c0f49e70871ab7def76bd2584e))
* new icons ([019e71f](https://github.com/episclera/portqueue/commit/019e71fb14c488296e39c0f6dc2477fa86ca36bf))
* pkg json ([1b4954e](https://github.com/episclera/portqueue/commit/1b4954ed77e583226dbb583b7dd951dd2d892ead))
* pkg lock ([e306589](https://github.com/episclera/portqueue/commit/e306589b0a2d2b879617af7b0a677efd663113a2))
* public api ([29e663e](https://github.com/episclera/portqueue/commit/29e663e9e9b6bd462e3bdb30448e68184f7de84f))
* rm raw plan ([5275537](https://github.com/episclera/portqueue/commit/527553745065ffe5aa76df4b5f537dd994352232))
* rm roadmap ([27f5638](https://github.com/episclera/portqueue/commit/27f5638a826b10d61c2643ebe256f6638fff8b39))
* rm todo ([ee67933](https://github.com/episclera/portqueue/commit/ee679336e200f94b55770e62e05003a6c21e50a9))
* todo ([f4adcef](https://github.com/episclera/portqueue/commit/f4adcefb36d522ac5dd29dc34156f439910b4fcc))
* todo t go back to per process pressure ([0afc9f1](https://github.com/episclera/portqueue/commit/0afc9f1358e4d91405361119a9cd6489ea97eb39))
* toto about prefered isnatnces ([5150dd3](https://github.com/episclera/portqueue/commit/5150dd3d83c3a0b710b7902bb7c0309081bf89d3))
* **ui:** keep an actions column's title on the left ([0f43620](https://github.com/episclera/portqueue/commit/0f436200f6f800c2f8b14ece16794c0f97e19cf8))
* work the audit backlog — claim fencing, CSRF, batch caps, DB-side reads ([3df7a7f](https://github.com/episclera/portqueue/commit/3df7a7fa2c0fbc64a4795b742d548a58288175b7))

### Code Refactoring

* **cli:** connect via --driver/--connection-string, drop config file ([91e9bef](https://github.com/episclera/portqueue/commit/91e9befa0818d055627ec0447d2c62a3c83c92f3))
* **cli:** split commands into a self-describing registry ([3b9f060](https://github.com/episclera/portqueue/commit/3b9f0603f049b6fbe42dcae6eb4bf410117820da))
* **core:** apply per-driver storage + column/metadata removal across all drivers ([b6b85a7](https://github.com/episclera/portqueue/commit/b6b85a7ac1d81ff3073b6db526341597421f5ca1))
* **core:** drop applied_at from the migration table ([6f414d3](https://github.com/episclera/portqueue/commit/6f414d3d640d67e0d93ebf08226e736e47234241))
* **core:** drop redundant purgeJobs in favour of removeJobs ([89edb28](https://github.com/episclera/portqueue/commit/89edb2824195e7901bb0de30528f248afd427d95))
* **core:** drop retention_mode and the schedule window columns ([763038e](https://github.com/episclera/portqueue/commit/763038e4438d0ad3e6f7c1cdbe530b803c205b1d))
* **core:** drop RetryMode from retryJob — one job id, one behaviour ([4ef9004](https://github.com/episclera/portqueue/commit/4ef90049785b44d2b89618e8b3a38473d94c2144))
* **core:** let PGLite inherit the Postgres SQL surface, collapse migrations to v1 ([86db559](https://github.com/episclera/portqueue/commit/86db559daed18aa0fddc9b7d1b1d447b1d32fa70))
* **core:** per-driver storage options; drop instance id, locked_by column, job metadata ([4e0608f](https://github.com/episclera/portqueue/commit/4e0608fd92b0f11b6cda331443801cfafcc6e3a8))
* **core:** per-table column enums; export schema identifiers ([d42cd5e](https://github.com/episclera/portqueue/commit/d42cd5e6ffd2db251e4267533da93a7266a5b9d0))
* **core:** remove Citus and Yugabyte drivers ([5d26913](https://github.com/episclera/portqueue/commit/5d2691311c8c6e13c27b429057f2f74a104f0701))
* **core:** standalone per-engine drivers with co-located migrations ([a43ab52](https://github.com/episclera/portqueue/commit/a43ab528aa80cd49720c4cc493b7ce3a983e06c3))
* **dashboard:** drop job metadata from DTOs, serializer, and add-options ([c25039b](https://github.com/episclera/portqueue/commit/c25039be2ab2e09a9d365899cf5312db57e5e4cc))
* **dashboard:** drop the Retry count column ([286edce](https://github.com/episclera/portqueue/commit/286edce0a0b0a3f497f146b27a8efde995301172))
* **dashboard:** fold the job timestamps into the details card ([c1955ab](https://github.com/episclera/portqueue/commit/c1955abfb6798b5d0c44bbd253471974054435b0))
* **dashboard:** lead the activity cards with Active ([b95d39f](https://github.com/episclera/portqueue/commit/b95d39f08c63bd6abd777b37224c7a6a545fab9d))
* **dashboard:** render every date as one exact local timestamp ([2a7332c](https://github.com/episclera/portqueue/commit/2a7332ce563f2bd10d77aac5183a6e95f415b3ea))
* **dashboard:** split create-dashboard + dto, add NestJS adapter ([b8fab01](https://github.com/episclera/portqueue/commit/b8fab0199cd2154efbc6eec01c1d8474f4178ae7))
* **docs:** render transactional-enqueue tabs from a shared constant ([1aa81ca](https://github.com/episclera/portqueue/commit/1aa81ca6d7d7985b9fd7ba3e10996875fc39b302))
* drop .js extensions from relative imports; use bundler resolution ([d353994](https://github.com/episclera/portqueue/commit/d35399407bb95adb4d00690a5cfb817e06a6af2d))
* flatten the API onto PortQueue and rebuild the driver layer ([471ba1e](https://github.com/episclera/portqueue/commit/471ba1e0411f66459969a1f9b6113cfcb4d65b3d))
* one seconds-only delay option, integer duration columns ([e86fe19](https://github.com/episclera/portqueue/commit/e86fe195dd8d381abb0036c44e1883d9ea1d1a32))
* rename the Postgres driver to PostgreSQL ([ac56aa0](https://github.com/episclera/portqueue/commit/ac56aa0f83e82f2698ef6660d9dbeaa85017e134))
* schema as versioned JSON; migrations generated by diffing ([1dd7d78](https://github.com/episclera/portqueue/commit/1dd7d78c3b1f36ba9f5340a635f99016c750c1cc))
* **schema:** JSON versions + predefined per-flavour migration folders ([b4041f5](https://github.com/episclera/portqueue/commit/b4041f563e00dbd10609e1fb40a347bcb27dfd4e))
* take every duration in seconds and delegate cron to cron-parser ([21df573](https://github.com/episclera/portqueue/commit/21df5731b111e0c074afc3c21196f24ddeaae5ce))
* **ui,dashboard:** replace styled-components with CSS Modules ([8caf770](https://github.com/episclera/portqueue/commit/8caf77067580cc2edddae27700ee1820210d4725))

### Documentation

* add a configuration reference page for constructor, queue, and worker options ([52a62f4](https://github.com/episclera/portqueue/commit/52a62f41a42b27f6b5cec65303e258f0bab63599))
* add a documentation links section to the README ([6ad18cb](https://github.com/episclera/portqueue/commit/6ad18cb191477918136a0815a19685f7ab84a454))
* add Advanced (custom driver) page, rename About category to More ([f75ac1e](https://github.com/episclera/portqueue/commit/f75ac1e25b4b38cca6ad3765affe3be1e595251b))
* add Team section to the home page ([2ade49c](https://github.com/episclera/portqueue/commit/2ade49c2f28c52e88cfa773618cc846b769f9d7f))
* **api-reference:** fix broken driver-authoring anchor to point at Advanced sections ([d432bc9](https://github.com/episclera/portqueue/commit/d432bc9d43c3a2ce205bbeff9abeb01a9723b925))
* bold the database names in the Database Agnostic homepage card ([0d2e9ab](https://github.com/episclera/portqueue/commit/0d2e9ab37c55df0365b8e681e6cc4b7a4f333445))
* clarify delayed cancel is non-recurring; point recurring to removeSchedule ([c273d90](https://github.com/episclera/portqueue/commit/c273d90c522bb503ec0d07545abbf751d0102afb))
* **cli:** note the driver peer dependency must be installed ([426a2ae](https://github.com/episclera/portqueue/commit/426a2aef98bf616dfae4bf4f4aeb3b2767796c5b))
* condense the no-update-by-design section in producing-jobs ([01ada6b](https://github.com/episclera/portqueue/commit/01ada6b085c66f57fcec09ded385afdc8d552687))
* consolidated API reference, CLI connection model, navbar + reorg ([e463cd9](https://github.com/episclera/portqueue/commit/e463cd9298fb16e20e1f1bb21c239bca4aa8ebbe))
* **dashboard:** cut the page to what a reader needs ([823117a](https://github.com/episclera/portqueue/commit/823117af33a91d0a4366701f0fb97a7f9303f15b))
* **dashboard:** show each page, in the reader's own theme ([9aaddc3](https://github.com/episclera/portqueue/commit/9aaddc3f63ee8ffb149b1f89eeb9792d5b3f1d12))
* derive footer Docs column from the sidebar ([a50c6ed](https://github.com/episclera/portqueue/commit/a50c6ed792820acdb12423432c1c2a36abebde6c))
* drop introduction page, number cancel patterns, add homepage license ([a5e83b9](https://github.com/episclera/portqueue/commit/a5e83b9d530999ee10513a09fba4945480d1831b)), closes [#license](https://github.com/episclera/portqueue/issues/license)
* drop the cross-instance cancel note from the canceling jobs page ([b9de1ec](https://github.com/episclera/portqueue/commit/b9de1ec928c6bfd80388d875c7c83824dd0d6f42))
* **examples:** add retries, idempotency, graceful-shutdown, and Postgres examples ([2478de7](https://github.com/episclera/portqueue/commit/2478de7e5c08b12b77506c9a73dc3f2e4c4d4891))
* **examples:** add runnable PGLite examples, dev launchers, and docs ([31a35b0](https://github.com/episclera/portqueue/commit/31a35b032e724f4d6a39f2b8df466478730ccc3c))
* **examples:** default Postgres examples to the repo dev DB for zero-config runs ([b0724c2](https://github.com/episclera/portqueue/commit/b0724c26da1203387ce7c3615863d6142fd0750a))
* **examples:** note saving the scheduleId to unschedule a recurring job ([766263f](https://github.com/episclera/portqueue/commit/766263fb4963abcafee7755ac464b16861fa71e6))
* **examples:** wait for recurrences in the recurring example ([dd494e3](https://github.com/episclera/portqueue/commit/dd494e34c497aea0fb46c101fa7a6c1af779eb05))
* expand CLI config + dashboard adapter docs ([d8dcab8](https://github.com/episclera/portqueue/commit/d8dcab8a29295e20471f7b86938b8d400d58e3da))
* fix dashboard Docker section — titled code cards, valid base image, dashboard-only run ([1003cc4](https://github.com/episclera/portqueue/commit/1003cc479d81bf295d5a80a0964ddfd744ffead6))
* fix footer license anchor false-positive and drop dead introduction link ([12ee6a7](https://github.com/episclera/portqueue/commit/12ee6a747f8854ce49cd9dc34cad3bb9a98f2067))
* fix initial examples ([8a6b308](https://github.com/episclera/portqueue/commit/8a6b308ef145829049ba14c8f69971071a6f88de))
* give every options table a Default column ([360d8e0](https://github.com/episclera/portqueue/commit/360d8e00e9a9be96dfda1b003bc12f5d13c431ff))
* lowercase 'to' in Scales to Many Servers card title ([08d4d72](https://github.com/episclera/portqueue/commit/08d4d7245e0d62fb1428379503d173cdc0019642))
* mark TODO items resolved ([efcc295](https://github.com/episclera/portqueue/commit/efcc2957dbe1fcaec58a19b409e463ca22336c8c))
* move 'Why not numeric progress?' to the end of the workflow intro page ([d934000](https://github.com/episclera/portqueue/commit/d9340008c718e42df6e1e18d28c7054007a5fc38))
* move duration note out of the config intro into an admonition ([98b6775](https://github.com/episclera/portqueue/commit/98b67754900bd9199fa02efba0096a2f5527d8ab))
* move the license blockquote to the end of the README ([c2727ce](https://github.com/episclera/portqueue/commit/c2727ce77ff1bf15679416e73f7d08bd59461914))
* name example queue handles {name}Queue and job results {name}Job ([5851084](https://github.com/episclera/portqueue/commit/5851084652e6f92d9df4c27fe23960cb5490390d))
* name MySQL among the supported engines ([ee2f3b6](https://github.com/episclera/portqueue/commit/ee2f3b600f07243673c513f04d9bac950cf6b725))
* new tagline, homepage card overhaul, comparison-table refresh ([a663719](https://github.com/episclera/portqueue/commit/a663719e2e77b1b79755f17b0c97ef3951f6f7f2))
* note Docker Postgres/Oracle for manual driver testing ([93d6826](https://github.com/episclera/portqueue/commit/93d6826d3d6c9656049d210cc535147ba8e3e3ae))
* point README 'full documentation' link at the site root ([65c855e](https://github.com/episclera/portqueue/commit/65c855e688c7dc4ba962c8ca4ddb66d39ed02d52))
* present a single process as a complete setup, not a producer/consumer split ([63f2a15](https://github.com/episclera/portqueue/commit/63f2a159545f4b4948500752823a7df7bedcab62))
* **production:** drop the tool-managed dedup caution ([e0b22bf](https://github.com/episclera/portqueue/commit/e0b22bf0086833335665ed5ba490fcd16ccb5ef8))
* promote roadmap to standalone ROADMAP.md and drop build_plan ([d6501e5](https://github.com/episclera/portqueue/commit/d6501e559099010e1810ccff110a8425edff8c53))
* reconcile docs with actual API surface ([49214d4](https://github.com/episclera/portqueue/commit/49214d44d0745c22c1436e33bacc8ad991ab05bf))
* restructure sidebar, consolidate pages, drop driver docs ([f35d07c](https://github.com/episclera/portqueue/commit/f35d07c133e925080b4b5a99eb2ca3a495e077be))
* **retention:** clarify in-flight statuses are never removed ([ac9c4e8](https://github.com/episclera/portqueue/commit/ac9c4e8cd80e6b47a1430b9935ed02f3b13ced70))
* **roadmap:** add execution locality (instance affinity) as the first item ([b6eb6a2](https://github.com/episclera/portqueue/commit/b6eb6a2f4c83db7bfa149da90fdfcf443927a719))
* SEO-optimize the docs site ([2c0f52c](https://github.com/episclera/portqueue/commit/2c0f52c9ff89e943daa43b9dfdc962e8f93c781c))
* sharpen affinity, cancellation and production guidance ([ce9e231](https://github.com/episclera/portqueue/commit/ce9e231e2621bca3b572861e0ac69677a0b5202e))
* **site:** tighten scaling and retention feature copy ([bf33bb7](https://github.com/episclera/portqueue/commit/bf33bb7666ebbaa0116ff34937aeca83fb7c8092))
* solid dark-green hero title, rename feature to 'Scalable horizontally' ([3c60a54](https://github.com/episclera/portqueue/commit/3c60a542f9fea5bda7b6227a5ea90e5dc98f4686))
* split "Remove jobs & schedules" into two sections ([001bfba](https://github.com/episclera/portqueue/commit/001bfbaa60d0c07052c7d2255878cbaaa87e7617)), closes [#remove-a-schedule](https://github.com/episclera/portqueue/issues/remove-a-schedule) [#remove-jobs](https://github.com/episclera/portqueue/issues/remove-jobs)
* split createQueue(...).method() chains in examples ([416c82a](https://github.com/episclera/portqueue/commit/416c82ab9cbfeb7d2474f6a3e3d5cce03146bdd7))
* split retryJob example into simple-job vs workflow-job cases ([1add884](https://github.com/episclera/portqueue/commit/1add884982860fd6f73a5c2df1eadfee65f55c66))
* split scheduling "Inspecting & unscheduling" into two sections ([05e3295](https://github.com/episclera/portqueue/commit/05e3295a7da93cce905f62580753bb72aae3af4e))
* SqliteDriver takes `path`, not `file` ([abd19ae](https://github.com/episclera/portqueue/commit/abd19aea34f09011e7109ca1594c93cc86f7abab))
* tasks ([8d970ac](https://github.com/episclera/portqueue/commit/8d970ac0b7f08508f78278a7231254ae0c647fbb))
* track the dashboard, CLI and driver-contract changes ([f2bfb09](https://github.com/episclera/portqueue/commit/f2bfb09fabf9840af1e619ac013ecb80969ae21a))
* trim Scheduling & Cron card copy ([2a1ad3e](https://github.com/episclera/portqueue/commit/2a1ad3ec0eb9ef37ceddc71b69caba26f52ac897))
* trim the API reference's Queue section to what a caller needs ([d574800](https://github.com/episclera/portqueue/commit/d5748000aaa6b1b81d823ca38b62bba54944d7d7))
* use Postgres in the README quick-start example ([8d1be0c](https://github.com/episclera/portqueue/commit/8d1be0cb2640fca64f6560f3f8e8f161e87d626d))
* white alert banners with only the title coloured by level ([88549f2](https://github.com/episclera/portqueue/commit/88549f207a4d5665e7d6a5eccf943f348b07953e))

### Tests

* **cli:** cover args, output, commands, config-loader, and run ([2581bfc](https://github.com/episclera/portqueue/commit/2581bfc025933d5fdd0c4bb7a05243d12f213422))
* **cli:** cover schedules without --queue now that it lists every queue ([9e85602](https://github.com/episclera/portqueue/commit/9e85602e541d7e6b63b9af18774763328900b525))
* **dashboard:** cover server logic + a React component ([15adfc8](https://github.com/episclera/portqueue/commit/15adfc8f621a167a7a24c293d95ae486c31457b5))
* **dashboard:** cover the actions endpoint; widen coverage to the client ([d595c58](https://github.com/episclera/portqueue/commit/d595c5871196bc87c17ec6f94b85eb039a42920f))
* **dashboard:** fix styled-components default-interop under ts-jest ESM ([0e1a798](https://github.com/episclera/portqueue/commit/0e1a798eaa846a57ee0ae56071fc51cb4695f5cc))
* **dashboard:** make jest css stub an ES module ([a84867b](https://github.com/episclera/portqueue/commit/a84867b4730d64e3d01dde1e662654e77431fea4))

### Build System

* add semantic-release as a root devDependency ([79e47dc](https://github.com/episclera/portqueue/commit/79e47dc712b1e0715966f02a985ab854734d2e33))
* lock semantic-release ([b6d08ad](https://github.com/episclera/portqueue/commit/b6d08ad0c9c3ccc5c5db49b2cc463dfac6835ceb))
* pin conventional-changelog-conventionalcommits to v9 ([a8dad93](https://github.com/episclera/portqueue/commit/a8dad933254d398c63956bc5fae8778c2dbf6de7))

### Continuous Integration

* deploy docs from the production workflow ([dc18f43](https://github.com/episclera/portqueue/commit/dc18f43be1ed97eb8a21b9c0319ae9870d9e301b))
* deploy docs only after packages are published ([feaf5c8](https://github.com/episclera/portqueue/commit/feaf5c839235990aa774dc04fbfdbcd42533699c))
* name the pr-check job validate ([42cdf62](https://github.com/episclera/portqueue/commit/42cdf62f06fa8b1806cf5052a212d996c650853e))
* release on every commit type ([e5927a6](https://github.com/episclera/portqueue/commit/e5927a66a30b994a691eeb1e83783dd888dc54f3))
* release with semantic-release on every push to main ([ae43e58](https://github.com/episclera/portqueue/commit/ae43e58a98905a7817e94ea42032641d3a5effc2))
* rename publish workflow to production ([6d747a2](https://github.com/episclera/portqueue/commit/6d747a2a880c1cefd0138add030e00860e65a883))
* replace changesets with release-please ([a33a6cf](https://github.com/episclera/portqueue/commit/a33a6cfaf9e53fe3871ea8e96efffc6b6bd4135e))
* run only on Node 24.x instead of a version matrix ([b4b7e4b](https://github.com/episclera/portqueue/commit/b4b7e4b8e6d38fc8d3b575e295e3fe3911e5451e))
* split production into validate, publish and deploy-docs jobs ([3321ef9](https://github.com/episclera/portqueue/commit/3321ef9478a5f9f2ad3c3b5ad75e7715529413b7))

### Miscellaneous Chores

* add committed .vscode/settings.json ([413ce9b](https://github.com/episclera/portqueue/commit/413ce9b0d6e386fe0bd1991bdd42142b77962a58))
* add scripts/ and .docker for local dev ([3d6b1fd](https://github.com/episclera/portqueue/commit/3d6b1fda0e453a67101c6972d7597755097f0111))
* add scripts/dev/setup.sh one-shot repo setup ([781d83c](https://github.com/episclera/portqueue/commit/781d83c324413cd97fff99a2d575c5df21b4a963))
* add suggestions ([de9ed42](https://github.com/episclera/portqueue/commit/de9ed42c0c4f54dc5cf905ef5b485fcdbd1f91c1))
* add todo with next fies ([bea9601](https://github.com/episclera/portqueue/commit/bea960174c015ccb9bdcf15c5429cee01f362b74))
* drop @changesets/cli from lockfile ([88891f7](https://github.com/episclera/portqueue/commit/88891f7de1c3e3823763e8b99d2c8a8e13ff0193))
* **examples:** name the dashboard examples' instance and always rebuild ([db5f4ec](https://github.com/episclera/portqueue/commit/db5f4ecbebee26c0e08829618478952b0f430838))
* **examples:** slow the dashboard examples' recurring report to 5m ([e3704dc](https://github.com/episclera/portqueue/commit/e3704dcfd74015f5eaaf615dbef91e1cb6b14511))
* move dev compose helper to scripts/utils/compose.sh ([609c5aa](https://github.com/episclera/portqueue/commit/609c5aa1c52059b7525cfcc9a9354cca46613c49))
* prepare the repo for going public ([31983df](https://github.com/episclera/portqueue/commit/31983df2d5095629a9d7105d956a299976fb23c1))
* release main ([f6c854a](https://github.com/episclera/portqueue/commit/f6c854a2c35bedbd628751554db2882e78126b90))
* release main ([e4975ad](https://github.com/episclera/portqueue/commit/e4975ade7cbc7c6174c2502b80e58bffe904802f))
* **release:** sync all packages at 1.0.0 ([7e260ca](https://github.com/episclera/portqueue/commit/7e260caf3c228e33995f35debf2ea91dc1b61041))
* remove scripts/README.md ([862cc77](https://github.com/episclera/portqueue/commit/862cc775957907d76d85452e4b24b3ac19349224))
* **scripts:** default sqlite/pglite CLI paths to repo tmp/ (gitignored) ([f21d299](https://github.com/episclera/portqueue/commit/f21d299cfe06b96def137d14bf111c06eede9592))
* typecheck-only tsconfigs + .npmignore for published packages ([497eb7b](https://github.com/episclera/portqueue/commit/497eb7b053bfc3ae1c30e559b2605166410051e4))
* update package-lock for dashboard test deps ([2301178](https://github.com/episclera/portqueue/commit/23011788ce0bcdcd5c81eb5c4eb0c18108c9dfca))

`@portqueue/core`, `@portqueue/dashboard` and `@portqueue/cli` share one version, so they share this
one changelog. Releases up to and including 1.0.2 predate it and were tagged per package
(`core-v*`, `dashboard-v*`, `cli-v*`); their notes are in the git history under those
[tags](https://github.com/episclera/portqueue/tags).
