# 18 — Security

**Secure by default.** PortQueue runs inside the customer's trust boundary and touches their database, so the bar is high: no injection surface, safe defaults, authenticated operational tools, and a real security test suite.

## 18.1 SQL injection — structurally impossible

- **All values are bound parameters.** No user value (payload, queue name, idempotency key, filter, limit) is ever concatenated into SQL. Every driver uses the engine's parameter binding (`$1`, `?`, `:name`).
- **All identifiers are allowlist-validated and quoted.** Schema, table prefix, table names, column names are not user free-text at query time: table/column names come from the internal `TableName`/schema enums; the only user-influenced identifiers are `schema` and `tablePrefix`, which are validated against a strict pattern (e.g. `^[A-Za-z_][A-Za-z0-9_]*$`, length-checked per engine) **at construction** and then quoted with the engine's identifier quoting. An invalid prefix/schema fails fast with a clear error (file 10.4) — it never reaches a query unescaped.
- **Queue names / schedule keys / idempotency keys** are treated as values (bound), never as identifiers, so they can't inject. They are length-bounded and, where used in channel names for NOTIFY, additionally sanitized/hashed to a safe channel token.
- A lint/review rule and a code convention: **no template-string SQL with interpolated variables** anywhere in `drivers/**`. The dialect base exposes only parameterized builders.

## 18.2 Payload safety

- Payloads are stored as opaque JSON/TEXT and returned to handlers as typed data; PortQueue never `eval`s or executes payload content. Handlers decide what to do with their own data.
- Size limits: `maxPayloadBytes` (a `PortQueueOptions` default, overridable per `QueueOptions`; default **1 MiB**) is enforced at `add` time against the serialized `data`, rejecting oversized payloads with a clear `INVALID_OPTIONS` error — preventing accidental giant rows / memory blowups (and respecting NOTIFY payload limits — we never put payloads in notifications anyway, file 03.4).
- Serialization is standard `JSON` (no custom deserializers that could execute code). Document that `Date`/`BigInt`/etc. round-trip as JSON allows; provide guidance rather than a bespoke serializer.

## 18.3 Dashboard security

- The dashboard endpoint is **auth-gated** (file 12.5): `basic` (hashed credential compare, constant-time), `custom` (reuse app auth/SSO), or `none` (docs warn: only behind a trusted network).
- **`readOnly` mode** disables every mutating endpoint server-side (not just hidden in UI).
- Action endpoints: same-origin/CSRF protection, server-side validation of every action against the core option schemas (a malicious client can't craft an invalid/oversized job), and rate-limiting-friendly.
- No secrets are exposed to the client bundle; the dashboard shows job data — document that operators should consider that job payloads may contain sensitive data and gate access accordingly (and offer a redaction hook via `serialize.ts`).

## 18.4 CLI security

- The CLI-served dashboard **requires** a root username/password (basic auth) before it will serve (file 13.3) — no accidentally-open dashboard.
- Connection secrets accepted via env (`PORTQUEUE_*`) so they don't land in shell history; `--password` documented as less-safe.
- `--json` output and confirmations prevent accidental destructive actions in scripts (`--yes` required).

## 18.5 Supply-chain / dependency posture

- **Near-zero runtime dependencies** (file 01.7) shrinks the attack surface. DB clients are optional peers the consumer chooses and controls.
- CI can run `npm audit` / dependency review on PRs; document the policy.
- No postinstall scripts in published packages; nothing auto-installs on the developer's behalf.

## 18.6 Multi-tenant / isolation guidance (docs)

- `schema` + `tablePrefix` let multiple apps share one DB without colliding; `namespace` isolates pub/sub channels.
- Document that queue-level access control (who may add/consume which queue) is the app's responsibility — PortQueue provides the mechanism (separate queues, the dashboard auth/readOnly, hooks to enforce tenancy in `BEFORE_ADD`) not a built-in authz model.

## 18.7 Security test suite (file 16)

- **Injection tests:** attempt SQL injection through queue names, idempotency keys, filters, and (invalid) `schema`/`tablePrefix`; assert either safe binding/escaping or an early validation error — never query corruption.
- **Identifier validation tests:** malicious prefixes/schemas rejected at construction.
- **Dashboard tests:** unauthenticated requests rejected; `readOnly` blocks mutations server-side; action payload validation rejects oversized/invalid input; CSRF/same-origin enforced.
- **CLI tests:** dashboard refuses to serve without credentials; destructive commands require confirmation.
- **Payload-size tests:** oversized payloads rejected with a clear error.

## 18.8 Local final-check checklist

- [ ] Every value is a bound parameter; no interpolated-SQL anywhere in `drivers/**`.
- [ ] `schema`/`tablePrefix` allowlist-validated at construction and quoted; invalid input fails fast.
- [ ] Queue/schedule/idempotency keys handled as bound values; NOTIFY channels sanitized; never carry payloads.
- [ ] Payload size limit enforced; standard JSON only; no eval/custom-exec deserialization.
- [ ] Dashboard auth-gated + server-enforced `readOnly` + validated actions + CSRF-safe; CLI dashboard requires credentials.
- [ ] Near-zero deps; no postinstall; nothing auto-installs; audit policy documented.
- [ ] Security test suite covers injection, identifier validation, auth/readOnly, payload limits.
