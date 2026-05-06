# CityWater Audit Framework

Operating manual for keeping CityWater honest. Specific to this codebase, this
stack, this architecture. Generic audit advice has been dropped in favour of
checks that catch the bugs *this system actually produces*.

Companion file: `AUDIT_TEMPLATES_AND_SCRIPTS.md` — the artifact template,
the scripted checks, and the cross-cutting infrastructure.

---

## How an audit works

Every audit produces an artifact. No artifact, no audit.

### Artifact location

```
docs/audits/
├── README.md                       # this file
├── TEMPLATES.md                    # template + scripts companion
├── _template.md                    # copy this for new audits
├── debt.md                         # accepted technical debt register
├── friction_map.md                 # UX friction, dated, with status
├── flake_log.md                    # flaky test tracking
├── 2026-Q2-security.md
├── 2026-Q2-content-integrity.md
├── 2026-04-monthly-lite.md
└── ...
```

Filename convention: `YYYY-QN-<audit-code>.md` for quarterly,
`YYYY-MM-<audit-code>.md` for monthly, `YYYY-MM-DD-<audit-code>.md` for ad-hoc.

### Severity rubric

| Severity | Definition | Action |
|---|---|---|
| **critical** | Active data loss, multi-tenant leak, auth bypass, regulatory non-compliance with active obligation | Block all merges. Fix within 24h. Hotfix to prod if already deployed. |
| **high** | Plausible exploit path, performance regression > 2×, content integrity error affecting active programs, restore drill failure | Fix this sprint. Block release that introduces new findings of this severity. |
| **medium** | Code quality, drift from spec, undocumented decision, slow query without user impact yet | Tracked issue. Address within the quarter. |
| **low** | Style, minor inconsistency, doc gap | Backlog. Address opportunistically. |
| **n/a** | Checkpoint doesn't apply this audit cycle | Note why. |

### Release gates

These severities, in these areas, **block deploy to production**:

- Any **critical** finding, anywhere, ever.
- **high** in: auth, multi-tenant isolation, audit log, content integrity for active programs/tasks, regulatory data capture, expression evaluator parity, backup restore drill.
- Two or more **high** findings in the same audit cycle (regardless of area).

Everything else is tracked but doesn't block.

### Honesty stance

Solo dev audits fail when you grade your own work. Mitigation: **Claude Code
drafts the audit, you edit it.** You're not the source of truth on whether
your code passes — the code is. Run the checkpoint script (where one
exists), let CC produce findings against the output, then push back where
you think it's wrong. Removes the bias.

---

## Audit catalog

| Audit | Code | Cadence | Effort | Gate? |
|---|---|---|---|---|
| Monthly lite | MON-LITE | monthly | 30 min | partial |
| Security | SEC | quarterly | half day | yes |
| Multi-tenant isolation | MT-ISO | quarterly + per-PR | 2h quarterly | yes |
| Content integrity | CONTENT | quarterly + monthly-lite | 1h quarterly | yes (active) |
| Expression evaluator parity | EXPR-PAR | quarterly + on evaluator changes | 30 min | yes |
| Code quality & technical debt | CODE | quarterly | half day | no |
| Testing coverage & quality | TEST | quarterly | half day | partial |
| Performance & spatial | PERF | quarterly | half day | no |
| UX / field workflow | UX | per-release + quarterly | varies | partial |
| Accessibility | A11Y | semi-annual | half day | no |
| Mobile / PWA | MOBILE | quarterly | 2h | no |
| Onboarding | ONBOARD | per workflow change + quarterly | 30 min | partial |
| Regulatory compliance | REG | semi-annual | half day | yes |
| Data integrity & audit trail | DATA | quarterly | 2h | yes |
| Workflow accuracy | WORKFLOW | semi-annual | half day | no |
| Infrastructure & deploy | INFRA | quarterly | 2h | no |
| Monitoring & alerting | OBS | quarterly | 1h | no |
| Backup & DR (with restore drill) | DR | quarterly | half day | yes |
| Secrets & config | SECRETS | semi-annual + automated | 1h | yes |
| Cost optimization | COST | quarterly | 1h | no |
| Error rate review | ERR | monthly | 30 min | partial |
| Feature usage | USAGE | quarterly | 1h | no |
| Scalability & load | SCALE | annual | 1 day | no |
| Knowledge silo | KNOW | semi-annual | 2h | no |
| Burnout & sustainability | BURN | quarterly | 1h | no |
| Process & tooling | PROC | quarterly | 1h | no |

---

## Section 1 — Software audits

### SEC — Security audit

**Cadence:** quarterly + after any auth/permission change
**Gate:** yes

**Checkpoints:**

- CP-SEC-1: All password hashes use Argon2id. Verify by sampling `user.password_hash` format.
- CP-SEC-2: Session cookies set `Secure`, `HttpOnly`, `SameSite=Lax`.
- CP-SEC-3: CSRF protection on every state-changing endpoint.
- CP-SEC-4: Rate limit on `/api/v1/auth/login` (10/min/IP).
- CP-SEC-5: All user input validated through Pydantic on the way in.
- CP-SEC-6: No `eval`, `literal_eval`, `exec`, `Function()`, or `vm.runInContext` anywhere. Especially in the expression evaluator.
- CP-SEC-7: HSTS, CSP, X-Frame-Options, X-Content-Type-Options headers set in production.
- CP-SEC-8: `pip-audit` and `npm audit` clean of high/critical vulns.
- CP-SEC-9: `gitleaks` scan of full git history clean.
- CP-SEC-10: `.env.example` files contain placeholders only, no real values.
- CP-SEC-11: Database user has minimum privileges (no SUPERUSER).
- CP-SEC-12: S3/B2/R2 keys are scoped to the bucket, not account-wide.
- CP-SEC-13: Audit log captures: login, logout, failed login, password change, role change, tenant config change.
- CP-SEC-14: PII (caller info on SRs) appears in logs only as IDs, never as values.
- CP-SEC-15: `bandit` clean on backend with project rules.

**Tools:** `pip-audit`, `npm audit`, `bandit`, `gitleaks`, `trufflehog`, OWASP ZAP one-pass against staging, manual review of every endpoint added since last audit.

**Failure → action:** CP-SEC-1 through CP-SEC-4 are critical. CP-SEC-7 through CP-SEC-15 are typically high.

---

### MT-ISO — Multi-tenant isolation audit

**Cadence:** quarterly + checkpoint on every PR that touches a query
**Gate:** yes (any severity)

**Why this gets its own audit:** one cross-tenant leak ends the company. Closer to security than to operations and deserves the weight.

**Checkpoints:**

- CP-MT-1: Every domain table has `tenant_id BIGINT NOT NULL`.
- CP-MT-2: Every SQLAlchemy session has the tenant filter event listener attached.
- CP-MT-3: Every API endpoint that touches tenant data uses session-derived `tenant_id`, never client-supplied.
- CP-MT-4: Cross-tenant fetch returns 404, not 403 (no information leak).
- CP-MT-5: Background jobs (RQ) carry `tenant_id` explicitly and apply it on session bind.
- CP-MT-6: File storage paths include `tenant_id` in the prefix; signed URLs are tenant-scoped.
- CP-MT-7: Search index (if any) filters by tenant.
- CP-MT-8: Audit log queries filter by tenant.
- CP-MT-9: Test suite includes a `cross_tenant_isolation` fixture-driven test that creates two tenants and asserts no endpoint can leak across them.
- CP-MT-10: PostGIS spatial queries (`ST_Within`, `ST_DWithin`, etc.) have an explicit `tenant_id =` predicate.

**Per-PR check** (any PR touching SQL):

- New queries include `WHERE tenant_id = :tenant_id` or rely on session listener.
- If listener relied on, no `db.session.execute(text("..."))` raw bypass.
- If raw SQL needed, `tenant_id` parameter is enforced.

**Tools:** `tools/audit/grep_unscoped_queries.py` flags suspicious queries (raw SQL without tenant_id, missing filter on key models). Output included in audit artifact. Cross-tenant isolation test suite must pass.

**Failure → action:** any finding is at minimum high. Cross-tenant data visibility is critical — hotfix.

---

### CONTENT — Content integrity audit

**Cadence:** quarterly (deep) + monthly-lite (smoke)
**Gate:** yes for active programs/tasks

**Why this exists:** task definitions, programs, canned comments, asset class schemas, season definitions are content, not code. They don't crash; they silently misbehave. Without an audit, broken content sits live for months.

**Checkpoints:**

- CP-CON-1: Every active `task_definition` parses cleanly through the validator.
- CP-CON-2: Every `show_if`, `auto_complete_when`, `expression`, spawn `when` evaluates without error against an empty context (parse-clean) and a fully-populated context (eval-clean).
- CP-CON-3: Every `task_definition.spawns[].task` resolves to an existing active task definition (or is documented pending — tracked).
- CP-CON-4: Every `task_definition.canned_comments[]` references an existing `canned_comment.category`.
- CP-CON-5: Every `task_definition.applies_to_classes[]` references an existing `asset_class.code`.
- CP-CON-6: Every active `program.task_definition_code` resolves to an active task.
- CP-CON-7: Every active `program.cadence` produces a valid `next_run_at` when previewed 12 months out.
- CP-CON-8: Every active `program.scope` resolves to a non-empty asset pool (or is flagged as "intentionally empty").
- CP-CON-9: Every `program_run` in `in_progress` is within its window or is past `window_end + grace_days`. None drifting.
- CP-CON-10: Every active `season` covers a non-zero number of days.
- CP-CON-11: Tenant seasons together cover all 365 days with no overlap > 1 day.
- CP-CON-12: Every `asset_class.attribute_schema` is valid JSON Schema.
- CP-CON-13: Every asset's `attrs` validates against its class's schema (sample 5% per class quarterly; full pass annually).

**Tools:** `tools/audit/content_integrity.py` runs all checkpoints and writes findings into the audit artifact. Run it; review output; sign off. Deterministic seed for sampling so progress is visible quarter-over-quarter.

**Failure → action:** findings on active programs/tasks are gating. Findings on draft or archived content tracked but non-blocking.

---

### EXPR-PAR — Expression evaluator parity audit

**Cadence:** quarterly + every PR that touches `app/services/expr.py` or `frontend/src/lib/expr.ts`
**Gate:** yes

**Why this exists:** the evaluator runs server-side (form validation, completion checks, spawn evaluation) AND client-side (live `show_if`, live validation). If they drift by one operator, every task definition behaves differently in two places. Highest-leverage parity check in the system.

**Checkpoints:**

- CP-EXPR-1: `tests/fixtures/expr_cases.json` contains at least 60 cases covering every operator, precedence chains, dotted paths, missing keys, null comparisons, type coercion edges, parse errors, season/weather context paths.
- CP-EXPR-2: Backend test suite passes the full fixture set with zero deviations.
- CP-EXPR-3: Frontend Vitest suite passes the full fixture set with zero deviations.
- CP-EXPR-4: A nightly CI job runs both suites against the same fixture file and posts diffs to a status channel. Any diff → failed audit.
- CP-EXPR-5: When a new operator/feature is added to the evaluator, it lands in *both* implementations in the same PR plus new fixture cases. Per-PR check.
- CP-EXPR-6: No usage of `eval`, `Function()`, `vm.runInContext`. Only the hand-written parser.

**Tools:** `tools/audit/expr_parity.sh` runs both suites, diffs results, exits non-zero on mismatch. Output goes into the audit artifact.

**Failure → action:** any divergence is at minimum high. Drift in production is critical.

---

### CODE — Code quality & technical debt audit

**Cadence:** quarterly
**Gate:** no (advisory)

**Checkpoints:**

- CP-CODE-1: `ruff check` clean on backend.
- CP-CODE-2: `mypy --strict` (or strict-equivalent project config) clean on backend.
- CP-CODE-3: `eslint` clean on frontend, no `// eslint-disable` without a justifying comment.
- CP-CODE-4: `tsc --noEmit` clean on frontend.
- CP-CODE-5: No function over 80 lines without a justifying comment.
- CP-CODE-6: No file over 500 lines without a justifying comment.
- CP-CODE-7: No `# type: ignore` or `// @ts-ignore` without a tracking issue.
- CP-CODE-8: TODOs older than 90 days reviewed: closed, addressed, or re-justified.
- CP-CODE-9: `vulture` (Python) and `ts-prune` (TS) flag dead code; reviewed and removed or kept with comment.
- CP-CODE-10: SQLAlchemy models use the typed `Mapped[...]` style throughout. No legacy `Column(...)` mixed in.
- CP-CODE-11: No business logic in API blueprints — that lives in `app/services/`.
- CP-CODE-12: No SQL strings hand-built with string interpolation (parameterized queries only).
- CP-CODE-13: Pre-commit hooks pass on a fresh clone.

**Debt tracker:** maintain `docs/audits/debt.md` — a living list of accepted debt with: item, why it's debt, severity, paying-it-down plan, age. Audit this list every quarter; close items no longer relevant; promote items aged badly.

---

### TEST — Testing coverage & quality audit

**Cadence:** quarterly
**Gate:** partial (critical-path coverage drops gate)

**Checkpoints:**

- CP-TEST-1: Total coverage for `app/services/` ≥ 85%.
- CP-TEST-2: Total coverage for `app/api/` ≥ 75%.
- CP-TEST-3: Coverage for `app/models/` is meaningless — skip this metric.
- CP-TEST-4: Critical path E2E tests exist for: login, asset CRUD, WO create-from-SR, WO complete (task-driven), inspection create, program run start, expression evaluator (Python ↔ TS).
- CP-TEST-5: Test suite full run completes in under 8 minutes locally.
- CP-TEST-6: Less than 1% flaky rate over the last 50 CI runs (track in `flake_log.md`).
- CP-TEST-7: Every public service-layer function has at least one happy-path and one error-path test.
- CP-TEST-8: Tests use factories (`factory-boy`, frontend equivalents), not raw model construction.
- CP-TEST-9: No test depends on test execution order.
- CP-TEST-10: PostGIS-using tests run against a real postgres+postgis container, not SQLite or mock.
- CP-TEST-11: The `expr_cases.json` fixture file has grown since last audit (or has a justified reason it hasn't).

**Failure → action:** drops in critical-path coverage (CP-TEST-4) gate releases. Other items advisory.

---

### PERF — Performance & spatial audit

**Cadence:** quarterly
**Gate:** no (regression > 2× is high; user-impact regressions case-by-case)

**Generic perf:**

- CP-PERF-1: p95 of `/api/v1/assets` list under 200ms on production data.
- CP-PERF-2: p95 of `/api/v1/work-orders/{n}/resolved` under 150ms.
- CP-PERF-3: No N+1 query patterns in critical endpoints.
- CP-PERF-4: Frontend bundle size under 2MB gzipped.
- CP-PERF-5: First contentful paint under 2s on throttled 4G to map view.
- CP-PERF-6: RQ worker queue depth stays under 100 during normal hours.

**Spatial / PostGIS — system-specific:**

- CP-PERF-SPAT-1: All `geometry` columns have a GIST index; verify via `\di` on `pg_indexes`.
- CP-PERF-SPAT-2: `EXPLAIN ANALYZE` on the bbox-filtered asset query uses the GIST index, not a seq scan.
- CP-PERF-SPAT-3: pg_tileserv tile generation under 200ms p95 for any layer.
- CP-PERF-SPAT-4: Vector tile cache hit ratio over 80% at the proxy.
- CP-PERF-SPAT-5: MapLibre renders 50,000 features at 60fps in viewport.
- CP-PERF-SPAT-6: JSONB queries use GIN indexes; check `EXPLAIN` on common `attrs->>'field'` filters.
- CP-PERF-SPAT-7: No haversine-in-Python in the codebase. Grep returns zero matches.

**Tools:** `tools/audit/perf_smoke.py` fires the canonical query set against a staging snapshot, captures timings, diffs against last quarter's baseline.

**Failure → action:** > 2× regression in any p95 is high. New seq-scans on previously-indexed paths are high. Frontend bundle bloat > 20% over baseline is medium with tracked issue.

---

## Section 2 — UX & design audits

### UX — Field workflow audit

**Cadence:** per-release for any workflow-touching feature + quarterly deep
**Gate:** partial — workflow-touching releases require a UX pass

**Benchmarks (gates per release):**

- CP-UX-1: A discoloured-water WO closes out in **≤ 6 taps + 3 numbers**.
- CP-UX-2: A reactive WO with no asset closes out in **≤ 8 taps + 2 numbers + 1 photo**.
- CP-UX-3: A planned WO from a program run closes out in **≤ 5 taps**.
- CP-UX-4: An SR intake takes **≤ 30 seconds** for an experienced dispatcher.
- CP-UX-5: Dispatching an SR to a WO is **1 tap** if the SR already has an asset linked.
- CP-UX-6: An operator can find their assigned WOs from any screen in **≤ 2 taps**.
- CP-UX-7: A field photo attached to a WO requires **≤ 2 taps** from the WO detail.

**Process:** time the canonical flows yourself with a stopwatch each release; record times in the artifact. Quarterly: at least one real operator (or you role-playing) walks through each canonical flow on a phone in real conditions.

**Friction map:** maintain `docs/audits/friction_map.md` — every confusing or slow moment encountered, dated, with status (open/fixed/wontfix).

**Failure → action:** missing a benchmark by > 50% on a release-touching audit blocks the release until addressed or the benchmark is consciously revised in this document.

---

### A11Y — Accessibility audit

**Cadence:** semi-annual
**Gate:** no (advisory; targets WCAG AA)

**Checkpoints:**

- CP-A11Y-1: Lighthouse accessibility score ≥ 90 on five core pages.
- CP-A11Y-2: All interactive elements reachable by keyboard.
- CP-A11Y-3: Visible focus indicator on all interactive elements in light and dark mode.
- CP-A11Y-4: Form fields have programmatic labels.
- CP-A11Y-5: Errors are announced to screen readers via aria-live.
- CP-A11Y-6: Color contrast meets AA for body text and AA Large for headlines.
- CP-A11Y-7: Map view has a non-map fallback for users who can't operate it.
- CP-A11Y-8: PWA install + camera access prompts are screen-reader-announced.

**Tools:** axe DevTools, Lighthouse, manual keyboard pass, occasional VoiceOver check.

---

### MOBILE — Mobile / PWA audit

**Cadence:** quarterly
**Gate:** no

**Checkpoints:**

- CP-MOB-1: PWA installs cleanly on iOS Safari and Android Chrome from current production.
- CP-MOB-2: Offline-cached assets render on map within last-cached bbox.
- CP-MOB-3: Mutation queue replays cleanly on reconnect with conflict UI for rejections.
- CP-MOB-4: Photo capture preserves EXIF GPS.
- CP-MOB-5: Touch targets ≥ 44×44px throughout.
- CP-MOB-6: One-handed reachability — primary actions in lower 60% of viewport on phones.
- CP-MOB-7: App is usable on a 4-year-old mid-range Android (test device or emulator throttle).
- CP-MOB-8: Gloved touch usable — no tiny targets, no precision drag for routine actions.
- CP-MOB-9: Battery: a 4-hour field session doesn't drain more than 30% beyond OS baseline.
- CP-MOB-10: Cellular data: a typical field shift consumes < 100MB.

**Tools:** real device testing required. Throttled browser dev tools as a coarse pre-check only.

---

### ONBOARD — Onboarding audit

**Cadence:** every workflow change touching first-run + quarterly
**Gate:** partial — onboarding regressions on release block

**Checkpoints:**

- CP-ON-1: A new operator completes their first WO with no documentation in ≤ 5 minutes.
- CP-ON-2: A new admin sets up a tenant (seasons, classes, default tasks) in ≤ 30 minutes.
- CP-ON-3: First-run helper text exists for every screen an operator can land on directly.
- CP-ON-4: Empty states are useful (not "No data") and explain how to add data.

---

## Section 3 — Domain & regulatory audits

### REG — Regulatory compliance audit

**Cadence:** semi-annual + on regulated-domain features
**Gate:** yes

**Checkpoints (Ontario baseline; extend per jurisdiction):**

- CP-REG-1: O. Reg 170/03 — distribution sample frequency by population is configurable per tenant and reportable.
- CP-REG-2: AWQI (Adverse Water Quality Incident) recording captures: detection time, parameter, value, response actions, MOH notification time. Reportable as a single record.
- CP-REG-3: Boil water advisory issuance is logged with: issuing authority, scope, reason, issuance time, lift time, notifications made.
- CP-REG-4: Bac-T sampling after main repair is enforceable (task definition requires sample ID before completion of follow-up).
- CP-REG-5: Chlorine residual logging at fixed sample stations is timestamped and attributable to operator.
- CP-REG-6: PACP version captured on every CCTV inspection; observation codes validated against the active PACP version.
- CP-REG-7: SSO/CSO recording captures: location, start time, stop time, estimated volume, receiving water (if any), notifications, regulatory submissions.
- CP-REG-8: Locate request handling honours Ontario One Call timing requirements; clock visible to operator.
- CP-REG-9: Audit log retention configurable per tenant, default 7 years; deletion outside retention is blocked at the application level.
- CP-REG-10: Required regulatory fields on tasks are enforced as `required_for_complete` in the task definition (not optional).

**Process:** read every regulation cited above against the current implementation. For each, identify the data captured, the reporting path, and whether any field gates are missing.

**Failure → action:** regulatory data capture gaps are gating. Add the field requirement to the task definition before merging anything that closes the gap.

---

### DATA — Data integrity & audit trail audit

**Cadence:** quarterly
**Gate:** yes

**Checkpoints:**

- CP-DATA-1: Every domain table has `created_at`, `updated_at`, `deleted_at` per the convention.
- CP-DATA-2: Audit log captures every mutation on tasks, WOs, SRs, inspections, and assets — sample 100 random rows from the last quarter, verify `before` and `after` JSONB are present and accurate.
- CP-DATA-3: Soft delete cascades correctly: deleting a WO does not orphan its tasks, time logs, materials, attachments. Test by sample.
- CP-DATA-4: Audit reconstructibility test: pick 5 closed WOs from > 1 year ago, reconstruct their full state from the audit log alone, compare to current state, account for any differences.
- CP-DATA-5: Task definition versioning: pick 3 WOs whose task definition has been versioned since the WO was created. Verify the WO still references its original version, not the current one.
- CP-DATA-6: No orphaned `program_run_asset` rows (asset deleted, program_run still references).
- CP-DATA-7: No orphaned `work_order_asset` rows.
- CP-DATA-8: All JSONB fields validate against their declared schemas (sample-based).
- CP-DATA-9: Foreign key constraints exist where claimed in the schema (no missing FKs from migration drift).
- CP-DATA-10: `address_cached` populated within 24h of asset geom change for ≥ 95% of assets in the last month.

**Tools:** `tools/audit/data_integrity.py` runs sampled checks and writes findings.

**Failure → action:** reconstructibility failures are critical. Orphaned rows and FK gaps are high.

---

### WORKFLOW — Workflow accuracy audit

**Cadence:** semi-annual
**Gate:** no (advisory)

**Checkpoints:**

- CP-WF-1: Every active task definition has been reviewed by an operator (or you doing the work) within the last 12 months.
- CP-WF-2: Every program has been observed running through at least one complete cycle since last review.
- CP-WF-3: Operator feedback ("this procedure is wrong / missing / unclear" button — see in-app feedback feature) backlog has < 30 open items, all triaged.
- CP-WF-4: Spawn rules: pick 10 spawn events from the last quarter, verify the spawned WO was useful (not noise). If > 20% are noise, the spawn rule needs revision.
- CP-WF-5: Canned comments: pick the 20 most-used and the 20 least-used. Least-used reviewed for relevance; most-used reviewed for whether they should be split (a too-popular chip often means it's hiding a missing form field).
- CP-WF-6: Comparison sample: pick 10 closed WOs and read their `task_data` and free-text comments. Are operators working around the form? If yes, the form is missing fields.

**In-app feedback requirement:** every task definition rendering must show a small "report a problem" button. Submissions create `task_definition_feedback` rows tagged to (task_definition_id, version, user_id). This is the input to CP-WF-3 and the closest thing to ground truth the system can produce.

---

## Section 4 — Infrastructure & DevOps audits

### INFRA — Infrastructure & deploy audit

**Cadence:** quarterly
**Gate:** no

**Checkpoints:**

- CP-INF-1: Railway services configured: backend, frontend, postgres, redis, pg_tileserv, RQ worker, RQ scheduler.
- CP-INF-2: Environment variables present in production, documented in `.env.example`, no extras unaccounted for.
- CP-INF-3: Database connection pool size matches Railway plan limits and worker count; verify no connection exhaustion in metrics.
- CP-INF-4: Idle connection timeout configured (no zombie connections from forgotten dev tools).
- CP-INF-5: Migrations run on deploy; rollback path documented.
- CP-INF-6: Cloudflare DNS records and SSL Full Strict configuration verified for each tenant's domain.
- CP-INF-7: Healthcheck `/healthz` returns 200 with DB ping and git sha; alerts wired to it.
- CP-INF-8: Background worker has a separate Railway service from web (so a stuck worker doesn't take down requests).

---

### OBS — Monitoring & alerting audit

**Cadence:** quarterly
**Gate:** no

**Checkpoints:**

- CP-OBS-1: Sentry (or equivalent) capturing both backend and frontend errors.
- CP-OBS-2: Logs are structured JSON in production with request IDs.
- CP-OBS-3: Alerts on: error rate spike, healthcheck failure, RQ queue depth > 500, database connection exhaustion, scheduler missed run.
- CP-OBS-4: No alert is fired more than 5×/week without action — if it is, it's noise; either fix the cause or raise the threshold.
- CP-OBS-5: Important business signals tracked: WO completion rate by tenant, average time-to-complete by category, program run progress.
- CP-OBS-6: A failed scheduler tick is a high-priority alert. Programs that don't fire are silent failures.

---

### DR — Backup & disaster recovery audit

**Cadence:** quarterly (with restore drill)
**Gate:** yes — failed restore drill is a high finding

**Checkpoints:**

- CP-DR-1: Postgres logical backup runs daily, retention 30 days minimum.
- CP-DR-2: Backups stored on a different provider than production (e.g. Railway DB backed up to B2 or R2).
- CP-DR-3: **Restore drill** — restore the most recent backup to a temporary database and verify: row counts match within tolerance, audit log queryable, `task_definition` content present, sample WO loads. Document the drill outcome and total time-to-restore in the audit artifact.
- CP-DR-4: File storage (S3/B2/R2) versioning enabled with lifecycle to retain previous versions for at least 30 days.
- CP-DR-5: Disaster runbook exists at `docs/RUNBOOK.md` and was reviewed this quarter.
- CP-DR-6: Time-to-restore (TTR) target is documented (recommend 4h) and the last drill met it.
- CP-DR-7: Tenant export available — every tenant can be fully exported to GeoJSON+CSV+attachment archive in a single command.

**Failure → action:** restore drill failure is high (gating). TTR > 2× target is high. Missing backups for any 24h window in the last quarter is critical.

---

### SECRETS — Secrets & config audit

**Cadence:** semi-annual + automated scans
**Gate:** yes

**Checkpoints:**

- CP-SEC-CFG-1: `gitleaks` scan of full git history (including all branches) clean.
- CP-SEC-CFG-2: `trufflehog` scan clean.
- CP-SEC-CFG-3: No secrets in any open PR (CI gate).
- CP-SEC-CFG-4: All long-lived API keys (Mapbox/satellite tile provider, email, geocoding) rotated within the last 12 months.
- CP-SEC-CFG-5: Database connection strings use a pooler (PgBouncer or equivalent) where possible.
- CP-SEC-CFG-6: No production credentials shared with development environment.
- CP-SEC-CFG-7: `.env.example` files match the keys actually consumed by the app — no missing entries, no orphans.

**Failure → action:** any secret found in git history is critical and triggers a key-rotation procedure.

---

### COST — Cost optimization audit

**Cadence:** quarterly
**Gate:** no

**Concrete failure modes (not "is spending growing"):**

- CP-COST-1: Postgres connection pool exhaustion — check Railway logs for pool full events. Common cause: forgotten dev tools holding connections.
- CP-COST-2: Idle connections — `pg_stat_activity` query during normal hours; > 20% idle is waste.
- CP-COST-3: Table bloat — `pg_stat_user_tables` for `n_dead_tup` ratio; vacuum tuning if > 20%.
- CP-COST-4: Unindexed JSONB queries — check `pg_stat_statements` for slow queries hitting JSONB without GIN index.
- CP-COST-5: ReportLab memory spikes (you have history with this on Candy Dash). PDF generation worker should be a separate service or queued, not inline in the request path.
- CP-COST-6: Vector tile cache configured with TTL; pg_tileserv not regenerating identical tiles every request.
- CP-COST-7: S3/B2/R2 lifecycle policies move attachments older than 90 days to cold storage (if cost-relevant at scale).
- CP-COST-8: Egress monitoring — same lever you found on Candy Dash. Watch for runaway query results being downloaded to dev environments.
- CP-COST-9: RQ worker count matches actual queue load; oversized worker fleet is waste.

---

## Section 5 — Operational & business audits

### ERR — Error rate review

**Cadence:** monthly
**Gate:** partial — sustained error rate increase blocks new feature work

**Checkpoints:**

- CP-ERR-1: Top 10 errors by frequency from last month. Each has a status: triaged, fixed, won't-fix-with-reason.
- CP-ERR-2: Errors that increased > 50% month-over-month are prioritized.
- CP-ERR-3: Recurring errors (same root cause, multiple incidents) get a permanent fix, not another patch.
- CP-ERR-4: Background job error rate < 1%.
- CP-ERR-5: 5xx rate < 0.1% of requests.
- CP-ERR-6: 4xx rate from authenticated users tracked separately — sustained high rate often means UI bug, not user error.

---

### USAGE — Feature usage audit

**Cadence:** quarterly
**Gate:** no

**Privacy stance up front:** aggregate, tenant-level counts only. No per-user behavioural tracking. No tracking that operators haven't been informed of through their tenant's privacy policy.

**Checkpoints:**

- CP-USE-1: WO creation by category over the quarter — surfaces which task types are actually doing work.
- CP-USE-2: Task definitions with zero invocations in the last quarter — candidates for archival or revision.
- CP-USE-3: Programs with all runs completing on time vs programs falling behind — surfaces capacity issues or unrealistic cadences.
- CP-USE-4: Canned comments usage distribution — long tail of unused entries gets reviewed.
- CP-USE-5: Map layers viewed vs hidden by tenant — informs default visibility.
- CP-USE-6: PWA install rate among field users — if low, the install flow needs work.

---

### SCALE — Scalability & load audit

**Cadence:** annual + before onboarding any tenant > 2× current largest
**Gate:** no

**Checkpoints:**

- CP-SCALE-1: Synthetic load test: 50 concurrent users, 10× current asset volume, 90-minute soak. p95 response times stay under documented targets.
- CP-SCALE-2: Map performance with 250,000 features in viewport — vector tile generation and frontend rendering both healthy.
- CP-SCALE-3: Bulk import: 100,000-asset GeoJSON imports in under 10 minutes.
- CP-SCALE-4: Daily scheduler tick across 50 simulated tenants completes in under 30 minutes total.
- CP-SCALE-5: Audit log query for "last 90 days for this tenant" completes in under 5s on a tenant with 10M audit rows.

**Tools:** Locust or k6 against staging snapshot.

---

## Section 6 — Solo dev audits

### KNOW — Knowledge silo audit

**Cadence:** semi-annual
**Gate:** no

**Process:** pick three areas of the codebase. For each, write a one-page explanation of how it works without looking at the code. Then read the code. The gap between your write-up and reality is the silo.

**Checkpoints:**

- CP-KNOW-1: `CLAUDE.md` accurately reflects current conventions; outdated lines flagged.
- CP-KNOW-2: `SPEC.md` decisions match implementation; drift logged.
- CP-KNOW-3: At least 5 architectural decisions documented as ADRs (Architecture Decision Records) at `docs/adr/`.
- CP-KNOW-4: Areas where you hesitate or had to re-derive logic during this audit get an ADR or inline comment.
- CP-KNOW-5: Onboarding doc (the one a hypothetical second developer would read) updated with anything learned this quarter.

---

### BURN — Burnout & sustainability audit

**Cadence:** quarterly
**Gate:** no

**Honest self-assessment, written in the artifact:**

- Hours per week on the project, average over the quarter
- Number of weekends with significant work
- Energy / motivation trend (improving / steady / declining)
- Ratio of new feature work to maintenance — too much maintenance is debt; too much new feature work is debt deferred
- Personal life proportion (time off, hobbies, partner time, time with Boots)

**Red flags requiring action:**

- > 50 hours/week sustained across 4+ weeks
- Declining motivation across two consecutive audits
- Skipping audits because "no time"
- Feature releases that you don't feel proud of

---

### PROC — Process & tooling audit

**Cadence:** quarterly
**Gate:** no

**Checkpoints:**

- CP-PROC-1: Claude Code success rate — a rough subjective score on whether sessions land good work. Trend matters more than absolute number.
- CP-PROC-2: Prompt patterns that worked well captured in `docs/prompts/`.
- CP-PROC-3: Repetitive tasks identified and scripted (Makefile, justfile, or scripts). New repetitive task each quarter usually means script needed.
- CP-PROC-4: Local dev environment startup time < 60s for `make dev`.
- CP-PROC-5: Editor (Zed) and shell (Fish) configured well; pain points logged.
- CP-PROC-6: Git workflow — branch hygiene, PR sizes, merge cadence — meets the conventions in CLAUDE.md.

---

## Monthly-lite audit (MON-LITE)

The 30-minute monthly. Smoke pass over the highest-leverage areas. Mostly automated.

**Steps:**

1. Run `tools/audit/monthly_lite.sh` — combines:
   - `pip-audit` and `npm audit`
   - `gitleaks` against the last month of commits
   - Content integrity smoke (CP-CON-1, CP-CON-3, CP-CON-6 only)
   - Expression evaluator parity (CP-EXPR-2, CP-EXPR-3)
   - Error rate snapshot from Sentry
2. Skim findings, file a ticket for any high/critical, sign off.
3. If any high or critical, escalate to a same-week deep dive of that area.

Artifact: `docs/audits/YYYY-MM-monthly-lite.md` — short, mostly script output.

---

## Calendar (full year, solo-dev realistic)

| Month | Audits |
|---|---|
| Jan | MON-LITE, ERR, **Q1: SEC, MT-ISO, CONTENT, EXPR-PAR, CODE, TEST, PERF, MOBILE, INFRA, OBS, DR, COST, USAGE, BURN, PROC, ONBOARD** |
| Feb | MON-LITE, ERR |
| Mar | MON-LITE, ERR |
| Apr | MON-LITE, ERR, **Q2: same as Q1, plus A11Y (semi-annual), REG (semi-annual), WORKFLOW (semi-annual), KNOW (semi-annual), SECRETS (semi-annual)** |
| May | MON-LITE, ERR |
| Jun | MON-LITE, ERR |
| Jul | MON-LITE, ERR, **Q3: standard quarterly set** |
| Aug | MON-LITE, ERR |
| Sep | MON-LITE, ERR |
| Oct | MON-LITE, ERR, **Q4: standard quarterly set + A11Y, REG, WORKFLOW, KNOW, SECRETS again** |
| Nov | MON-LITE, ERR, **SCALE (annual)** |
| Dec | MON-LITE, ERR |

The big quarter (Q1 and Q3) is a sustained week. The semi-annual quarter (Q2 and Q4) is closer to two weeks. Plan deliberately.

---

## Highest-ROI starting set

If you can only sustain a few audits, the order to add them:

1. **CONTENT** + **EXPR-PAR** — your declarative content is the system's brain; broken content is invisible.
2. **MT-ISO** — one cross-tenant leak ends the company.
3. **SEC** — non-negotiable for municipal software.
4. **DR with restore drill** — backups that haven't been restored aren't backups.
5. **UX** with the tap benchmarks — the differentiator vs Cityworks.
6. **REG** — directly tied to your domain.
7. **MON-LITE** — the discipline anchor.

Everything else is layered on as the project matures.

---

## Pointer to existing CC instructions

The audit framework doesn't exist in a vacuum. Audits verify whether the
implementation honours these contracts:

- `CLAUDE.md` — conventions and hard rules
- `docs/SPEC.md` — functional spec
- `docs/cc/LINK_AUTOPOPULATION.md` — link-driven resolution
- `docs/cc/TASK_DEFINITIONS.md` — task definition system
- `docs/cc/SEASONAL_PROGRAMS.md` — programs and seasonal context

Findings should reference the contract being violated (e.g. "CP-MT-3 fails;
violates CLAUDE.md hard rule #4 — tenant_id from session, not request").
