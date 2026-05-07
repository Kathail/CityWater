# Handoff — production deploy + post-audit hardening sweep

**Production:** [citywater.ca](https://citywater.ca) (marketing) and [app.citywater.ca](https://app.citywater.ca) (app). Demo at [/try-demo](https://app.citywater.ca/try-demo) auto-logs into a sandbox tenant pre-loaded with 12 months of synthetic activity.

**Latest commit on `main`:** `493f685` (P2 polish sweep). Backend reports its `RAILWAY_GIT_COMMIT_SHA` at `/healthz` so you can confirm what's deployed: `curl -s https://backend-production-f929.up.railway.app/healthz`.

## Where things stand right now

| Area | State |
|---|---|
| **Frontend tests** | **202** passing (`cd frontend && npx vitest run`) |
| **Backend tests** | **388** passing (`cd backend && uv run pytest`) — was 378 before the P2 sweep added 10 new tests |
| **Migrations** | 0001 → 0029 apply cleanly. Latest: `0029_audit_hardening` (work_order_asset tenant_id + updated_at, JSONB GIN indexes, crew_id partial index). |
| **Lint / typecheck** | Clean: `npm run lint`, `npx tsc -b`, `prettier --check`, `ruff check`, `ruff format --check`. |
| **Production health** | All three Railway services green; deep healthz returns `postgres: ok / postgis: 3.7 / redis: ok`. |
| **CI** | `.github/workflows/ci.yml` runs four jobs per PR: backend (lint+test), frontend (lint+test+build), marketing (build), docker (all three image builds). |

## Production architecture (Railway)

Five services, all on the Hobby plan:

1. **marketing** → `marketing/Dockerfile` at citywater.ca. Static brochure (Tailwind v4, no JS framework). nginx with `Cache-Control: public, immutable` for `output.css`, 5 security headers.
2. **frontend** → `frontend/Dockerfile` at app.citywater.ca. nginx serves the SPA + proxies `/api/*` to backend over Railway's private network. Uses the upstream nginx-alpine `15-local-resolvers.envsh` helper to inject `${NGINX_LOCAL_RESOLVERS}` (Railway's IPv6 resolver, bracket-wrapped) at boot. PWA service worker uses `registerType: "autoUpdate"`.
3. **backend** → `backend/Dockerfile`. Flask + gunicorn behind `ProxyFix(x_for=1, x_proto=1, x_host=1)`. Runs `flask db upgrade` on container start before exec'ing gunicorn. Public domain: `backend-production-f929.up.railway.app`.
4. **PostgreSQL + PostGIS** (Railway template at version 3.7).
5. **Redis** (Flask-Limiter rate-limit storage).

Key ops endpoints:

- `GET /healthz` → cheap liveness probe (Railway healthcheck target).
- `GET /healthz/deep` → operator-facing readiness: Postgres `SELECT 1`, PostGIS `PostGIS_version()`, Redis `PING`. Curl after a deploy to confirm the stack is wired correctly.

## What landed this session (chronological)

### 1. Dashboard iteration 2 (`2a5534a`)
- Introduced `DashCard` primitive — single source of truth for the dark-slate panel with title row + "See all" affordance.
- `KpiHero`, `ByArea`, `TodayQueue`, `ServiceRequestsCard`, `CategoryChart`, `ThroughputSpark`, `RecentActivity` all rewrapped in DashCard for consistent chrome.
- `ByArea` switched left-border bands to inline domain chips; zero counts hidden; per-domain "All quiet" fallback.

### 2. Five-page row-action refinement (`7389b49`)
- Assets, Inspections, Service Requests, Work Orders, Reports each got richer row actions and clickable summary stats.
- New deep-link mechanism: `?new=1&asset_uid=…` on `/work-orders` and `/inspections` auto-opens the create dialog with prefilled fields. Lets the Asset detail page fire "Create work order" and "Create inspection" without navigating users into an empty form.
- Reports gained per-card favorites + "Last run" + Pinned/Recently-used sections, all backed by localStorage (`features/reports/usage.ts`).
- Work Order due-date cell shows a relative chip ("Due today" / "in 3d" / "1d overdue") plus the absolute date.

### 3. Dashboard iteration 3 (`02984c3`)
- KPI tiles: full tile is now the link target (was: confusion between value vs. tiny "view →"). Each tile gets a context-aware quick action revealed on hover.
- `ServiceRequestsCard` + `ThroughputSpark` collapsed into a single `SystemPulse` panel. Right rail went from 3 cards to 2.
- Priority bar segments are individually clickable (deep-link to SR list filtered by priority — frontend client-side filter since the API doesn't support `priority=` server-side yet).
- `RecentActivity` row is the link; comment vs status-change rendered as distinct icon chips.

### 4. Demo flow + Railway DNS fix (`a698ea9`, `b0277f4`, `8f7b294`, `ff1c56a`, `8fca6a8`, `6074f0c`, `6d7c7b6`, `4553e41`)
- New zero-friction demo: marketing "Try the demo" → `/try-demo` → auto-login → tenant home. No sign-in form to fight with.
- `DemoBanner` shown when `tenant.slug === "demo"`: green strip, contact email, back-to-marketing link.
- `DemoLoginPage` rewritten with imperative async + ref guard (StrictMode-safe), per-step status label ("Initialising / Authenticating / Loading your dashboard"), 8-second watchdog that surfaces a stalled state with retry + "Reset cache & reload" buttons, 12-second hard timeout on the login fetch, console-traced for triage.
- **Service worker** flipped from `registerType: "prompt"` to `"autoUpdate"` so returning visitors auto-receive the latest bundle. `/api/v1/auth/me` removed from runtime cache (a stale 401 from a prior unauthenticated visit could poison the next login).
- **TenantShell** got a mobile drawer nav (hamburger + slide-in from left, backdrop tap / Esc / route-change closes it). Sidebar collapses on `<md` viewports.
- **Two cascading bugs** unwound via Playwright probe:
  1. The auto-login route was originally `/demo`. Demo tenant slug is also `demo`. After login, `navigate("/demo/")` re-matched the same route — endless spinner. Renamed to `/try-demo`.
  2. A courtesy redirect `/demo → /try-demo` *also* caught the post-login navigate, bouncing the visitor back to `/try-demo` until the rate limiter fired. Removed the redirect.
- **Railway DNS:** the original nginx config tried `resolver 127.0.0.11` (Docker-Compose convention). Railway's private network is IPv6-only (`fd12::10`). Switched to `NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1` so nginx-alpine's upstream `15-local-resolvers.envsh` reads `/etc/resolv.conf` and bracket-wraps IPv6 addresses correctly.
- `GIT_SHA` falls back to `RAILWAY_GIT_COMMIT_SHA` so `/healthz` always reports the deployed commit.

### 5. `/healthz/deep` readiness endpoint (`6a1f699`)
- New operator-facing endpoint that explicitly probes Postgres, PostGIS, and Redis. Returns 200 only if everything is green. Used to verify production health post-deploy and as the source-of-truth for any future uptime-monitor wiring.

### 6. Five-agent deep audit
- Spawned five parallel agents (security/multi-tenancy, backend code quality, frontend, DB+migrations, infra+docs) against the full repo. Punch list collated to **8 P0s + ~35 P1s + ~50 P2s**.

### 7. Post-audit hardening sweep (`164c4a1`)

**P0 — security and correctness:**
- **Cross-tenant `db.session.get` sweep.** `db.session.get(<TenantScopedModel>, id)` short-circuits the session-level tenant filter listener via the identity map. Any logged-in user could read/edit/delete tenant B's rows by ID enumeration. Replaced with `db.session.scalar(select(M).where(M.id == id))` across `links.py`, `comments.py`, `schedules.py`, `service_areas.py`, `task_definitions.py`, `invitations.py`, plus `_author_name` helper. **7 cross-tenant exposure points closed.**
- **AuditLog reads.** `history.py:57` had no `tenant_id` filter — AuditLog isn't `TenantScopedMixin` so the listener doesn't help. Added explicit `AuditLog.tenant_id == current_user.tenant_id`.
- **`@require_roles` on ~12 mutation endpoints.** Many WO/Inspection/SR endpoints were `@login_required` only — `readonly` and `intake` users could mutate state. Added role gates to `update_work_order`, `transition_work_order`, `add/remove/update WO assets`, `add/update WO tasks`, `log_time`, `log_material`, `upload_attachment`, `update_inspection`, `update_service_request`.
- **AssetClass writes locked.** `AssetClass` is a globally-shared catalog (no `tenant_id`). Any tenant admin's edits would affect every tenant. Now gated behind `ALLOW_ASSET_CLASS_EDITS` env (default off). Long-term: per-tenant copy-on-customize (in BACKLOG.md).
- **`ServiceRequest.address` AttributeError.** `api/service_requests.py:178` used a column that was renamed to `reported_address` in migration 0022. `?q=…` would 500 on every SR list. Fixed.
- **HTML email XSS.** `services/email.py` interpolated `tenant_name` directly into the HTML body. Tenant name is user-controlled at register-tenant — a tenant called `<script>…` would land verbatim in invitee inboxes. Now `markupsafe.escape()`'d.
- **Marketing hero placeholder.** `marketing/index.html:209` was rendering literal `[ replace with /public/screenshots/dashboard.png ]` to live visitors. Replaced with a 1200×675 inline SVG mockup of the supervisor dashboard.
- **`.dockerignore` files.** Added to `backend/`, `frontend/`, `marketing/`. Previously `docker build` was sending `.venv`, `node_modules`, `.git`, *and any local `.env`* into the image build context.

**P1 — backend:**
- `/auth/password/change` is rate-limited (was unthrottled — stolen sessions could brute-force the current password).
- Email accept-URL no longer logged at INFO (the URL contains a secret single-use token).
- `xml.etree` → `defusedxml` in WinCAN import (XXE / billion-laughs hardening).
- `WorkOrder.template_id` declares its FK in the model (matched live migration 0015's deferred constraint; autogenerate would otherwise propose dropping it).
- **Migration `0029_audit_hardening`:**
  - `work_order_asset` gets `tenant_id` (backfilled via `UPDATE … FROM work_order`) + `updated_at` + named FK + index. CLAUDE.md required this; the listener now applies directly to the join table.
  - GIN(`jsonb_path_ops`) indexes on `work_order.attrs`, `service_request.attrs`, `audit_log.before`, `audit_log.after`.
  - Partial index on `work_order(tenant_id, crew_id) WHERE deleted_at IS NULL`.
- `/healthz/deep` no longer echoes raw exception strings to unauthenticated callers (could leak DB connection strings or SQL fragments).
- `soft_delete_user` refuses to remove the tenant's only remaining admin.
- `Settings.secret_key` validates: hard-fails when `environment` is not `development`/`test` and the dev default is still set. Prevents silently booting with a known-public secret in prod.
- S3 settings moved from `os.environ.get(...)` into pydantic-settings (CLAUDE.md "no hardcoded values"). Added `_safe_name()` regex for S3 key sanitisation.

**P1 — frontend:**
- `TenantShell` uses `queryClient.clear()` on sign-out (was leaving stale tenant data in cache between logins on the same browser).
- `TenantShell` redirects when URL slug ≠ session tenant slug. Pasting `/tenantB/assets` while logged into A no longer renders chrome that lies about the active tenant.
- Native `alert()` in WO + SR list pages replaced with the existing `<Alert>`. Native `confirm()` replaced with `<ConfirmDialog>`.
- Mutation `onSuccess` invalidates `["dashboard"]` so list-page transitions refresh KPI badges immediately.

**P1 — infra:**
- 5 security headers on the SPA shell + marketing brochure (HSTS, X-Frame, X-Content-Type, Referrer-Policy, Permissions-Policy). Backend already set these on API responses.
- `index.html` now serves with `Cache-Control: no-cache` so the SPA shell never outlives the hashed bundle pointer it references.
- Pinned `frontend/Dockerfile` to `node:20.18-alpine` + `nginx:1.27-alpine` (was floating). Marketing aligned.
- `backend/Dockerfile` copies `uv.lock` for reproducible installs.
- CI gained a marketing build job and a docker job that builds all three images per PR. Pre-commit ruff bumped from `v0.4.4` to `v0.15.12` (matches what `uv sync` resolves so "passes locally / fails in CI" can't happen on lint).

**Docs:**
- `README.md` refreshed (was stuck on "Sprint 1 complete; next: S2").
- New `docs/API.md` — endpoint catalog by resource area (the live OpenAPI lives at `/api/v1/openapi.json`).
- New `docs/DATA_MODEL.md` — schema overview + conventions reference.
- `Makefile` `seed-demo` and `simulate-year` targets (were a stale "no seeds in S0" stub).

### 8. P2 polish (`493f685`)

**Backend:**
- Hoisted the duplicated `_validate(model_cls, data)` helper out of 11 blueprints into `app/api/__init__.py::validate_request`. Each blueprint imports it as `_validate` so call sites are unchanged. 88 lines of copy-paste removed; one place to evolve error formatting.
- Narrowed bare `except Exception` blocks in `services/exif.py` to the parsers' real exception types.
- Replaced `abort(400)` and `abort(413)` with typed `ValidationError(..., status_code=N)` from `app/errors.py`. The XYZ-tile contract still returns 400; oversized imports still return 413.
- Removed dead `now_utc()` helper from `services/sr_duplicates.py`.

**Frontend:**
- Extracted `WO_STATUS_TONE` / `WO_PRIORITY_TONE` into `features/work-orders/tones.ts` and `SR_*_TONE` into `features/service-requests/tones.ts`. WorkOrderListPage, WorkOrderDetailPage, and ServiceRequestListPage all import from the shared modules now (3 copies → 1).
- Kanban board registers a `KeyboardSensor` alongside `PointerSensor`. Tab to a card, Space to pick up, arrows to move, Space to drop.

**Tests (backfilled the highest-leverage gaps):**
- New `tests/test_comments.py`: CRUD lifecycle + an explicit cross-tenant test that asserts the P0-1 fix (admin in tenant A can't edit/delete a comment in tenant B).
- New `tests/test_dashboard.py`: response-shape smoke test, KPIs reflect seed data, tenant-scoping (a WO in another tenant must not appear).
- Three new tests in `tests/test_service_requests.py`: q-search no longer 500s (regression for P0-5), q matches caller_name + description, priority data present in list responses.

**Infra/docs:**
- `frontend/railway.toml` + `marketing/railway.toml` stubs so per-service build + healthcheck config is source-controlled.
- `DEPLOY.md` `/register` wording fixed (was inaccurate about the route vs. the API endpoint that's actually rate-limited).
- Frontend Docker `HEALTHCHECK` keeps probing `/` (not `/healthz`) with a comment explaining why we deliberately don't couple frontend health to backend.

**Permissions:**
- New project `.claude/settings.json` with a curated read-only allowlist for `curl`, `npx tsc/vitest`, `npm run lint/build/test`, `railway logs/variables`. Should drop ~250 prompts per session.

## Production health (last verified post-`493f685`)

```json
GET https://backend-production-f929.up.railway.app/healthz/deep
{
  "ok": true,
  "version": "493f6850ba19",
  "environment": "production",
  "checks": {
    "postgres": { "status": "ok" },
    "postgis":  { "status": "ok", "version": "3.7 USE_GEOS=1 USE_PROJ=1 USE_STATS=1" },
    "redis":    { "status": "ok" }
  }
}
```

Frontend + marketing both serve 200 with full security headers. Demo flow lands cleanly into the dashboard via Playwright probe. The SR `?q=` regression test passes. Tile bad-coord still returns 400 (typed-error swap preserved the contract).

## Open work (BACKLOG.md + audit residue)

- **Recurring Work Orders (SPEC §3.10).** `wo_template` schema delta is documented but unimplemented. AC1–AC7 in §7 are not actually achievable without the recurring fields (`target_mode`, `frequency_*`, `active`, `pause/resume`).
- **Per-tenant AssetClass.** Current global catalog is gated by `ALLOW_ASSET_CLASS_EDITS=false`. Real fix is copy-on-customize so a tenant can fork the global row.
- **Per-bar `aria-label` on the dashboard sparkline** + per-domain link from `ByArea` so clicking a domain row lands on a map filtered to that area (today every row goes to `/{slug}/map` with no focus context).
- **Modal focus-trap.** ~10 dialogs (`ConfirmDialog`, `CreateWorkOrderDialog`, `CreateInspectionDialog`, `IntakeDialog`, `DispatchDialog`, `AddAssetDialog`, `ImportDialog`, `ImportPacpDialog`, `CreateScheduleDialog`, the inline close-SR dialog) lack a focus trap. Tab keys can escape behind the backdrop.
- **N+1 cleanup.** Audit flagged a handful of `db.session.get` calls inside list-row builders that should use already-`lazy="joined"` relationships (work-orders list, inspections list, dashboard `_today_queue` and `_throughput_7d`). Functional today; perf-only.
- **Test coverage backfill** for `service_areas`, `map_overlays`, `crews`, `history`, `email` driver. The P2-C wave covered dashboard, comments, and SR; the rest remain.
- **Magic numbers** still live as module constants: `_ATTACHMENT_MAX_BYTES = 25 MiB`, `_DUPLICATE_RADIUS_M = 100.0`, dashboard pane `.limit(N)` values. Move into `Settings` so prod can tune without a deploy.

## Quick reference

```sh
# Full local stack
make dev                              # bring up postgres, redis, minio, pg_tileserv
cd backend && uv run flask --app app.wsgi seed-demo
cd backend && uv run flask --app app.wsgi run --debug --port 5000
cd frontend && npm run dev            # http://localhost:5173

# Health
curl -s https://backend-production-f929.up.railway.app/healthz/deep | jq

# Test suites
cd backend  && uv run pytest          # 388 tests
cd frontend && npx vitest run         # 202 tests

# Railway ops
railway logs --service backend
railway logs --service frontend
railway variable list --service backend

# Demo creds
slug=demo  email=admin@demo.citywater.io  password=DemoPassword123!
```
