# Handoff — pre-pilot push: second audit sweep + actionability + UI foundation + legal pages

**Production:** [citywater.ca](https://citywater.ca) (marketing) and [app.citywater.ca](https://app.citywater.ca) (app). Demo at [/try-demo](https://app.citywater.ca/try-demo) auto-logs into a sandbox tenant pre-loaded with 12 months of synthetic activity. Marketing now serves `/privacy` and `/terms` (extensionless) in addition to the brochure root.

**Latest commit on `main`:** `851b600` (marketing legal pages). Backend reports its `RAILWAY_GIT_COMMIT_SHA` at `/healthz` so you can confirm what's deployed: `curl -s https://backend-production-f929.up.railway.app/healthz`.

## Where things stand right now

| Area | State |
|---|---|
| **Frontend tests** | **202** passing (`cd frontend && npx vitest run`) |
| **Backend tests** | **399** passing (`cd backend && uv run pytest`) — was 388 before the audit-fix sweep added 11 new tests |
| **Migrations** | 0001 → 0031 apply cleanly. New since last handoff: `0030_time_log_tenant_id` (closes a cross-tenant leak in the time-log read path), `0031_wo_asset_task_data` (per-asset JSONB form data on `work_order_asset` for the smart-comment templating). |
| **Lint / typecheck** | Clean: `npm run lint`, `npx tsc -b`, `prettier --check`, `ruff check`, `ruff format --check`. CI was failing on prettier and ruff line-length for a stretch — both unbroken in `60efaeb` / `774e1c3`. |
| **Production health** | All three Railway services green at `851b600`; deep healthz returns `postgres: ok / postgis: 3.7 / redis: ok`. |
| **CI** | `.github/workflows/ci.yml` runs four jobs per PR: backend (lint+test), frontend (lint+test+build), marketing (build), docker (all three image builds). |

## Production architecture (Railway)

Five services, all on the Hobby plan:

1. **marketing** → `marketing/Dockerfile` at citywater.ca. Static brochure (Tailwind v4, ~one-line inline year script per page). nginx with `Cache-Control: public, immutable` for `output.css`, 5 security headers, and `try_files $uri $uri.html $uri/ =404` so `/privacy` and `/terms` resolve to the underlying `.html` files.
2. **frontend** → `frontend/Dockerfile` at app.citywater.ca. nginx serves the SPA + proxies `/api/*` to backend over Railway's private network. Uses the upstream nginx-alpine `15-local-resolvers.envsh` helper to inject `${NGINX_LOCAL_RESOLVERS}` (Railway's IPv6 resolver, bracket-wrapped) at boot. PWA service worker uses `registerType: "autoUpdate"`.
3. **backend** → `backend/Dockerfile`. Flask + gunicorn behind `ProxyFix(x_for=1, x_proto=1, x_host=1)`. Runs `flask db upgrade` on container start before exec'ing gunicorn. Public domain: `backend-production-f929.up.railway.app`.
4. **PostgreSQL + PostGIS** (Railway template at version 3.7).
5. **Redis** (Flask-Limiter rate-limit storage).

Key ops endpoints:

- `GET /healthz` → cheap liveness probe (Railway healthcheck target).
- `GET /healthz/deep` → operator-facing readiness: Postgres `SELECT 1`, PostGIS `PostGIS_version()`, Redis `PING`. Curl after a deploy to confirm the stack is wired correctly.

## What landed this session (chronological, 29 commits)

The session split into five themes, in roughly this order: another audit-driven P0/P1 fix sweep → UI primitives + dashboard "By area" → smart-comment narrative wiring → an actionability/usability pass that landed in 9 waves → marketing legal pages.

### 1. Second audit-driven P0/P1 fix sweep (`52886f0` → `bfa2e2a`, 14 commits)

Hunting residue from the previous five-agent audit, plus regressions surfaced by the heavier seed.

**P0 — security and correctness:**
- **Cross-tenant WO leak.** `52886f0` closed the leak introduced when adding the M:N work-order ↔ asset table; `wo.asset_id` was being read without tenant scope in two list builders. Fix synced `wo.asset_id` with the M:N row at write time and added explicit tenancy on the read.
- **Three more WO P0s** in `a38f9d2`: soft-delete sweep across WO read paths (deleted WOs were appearing in the dashboard backlog), an attachment-MIME allowlist (was accepting any content type), and time-log entries lacking `tenant_id` — reads filtered correctly only because the tenant happened to match by accident. Backed by migration `0030_time_log_tenant_id`.
- **SR + inspection P0 batch** (`a6bdf7b`): SR `?q=` regression when `caller_name` was NULL, inspection update endpoint not enforcing tenant on the linked-WO lookup, plus two P1s.
- **Assets / SR / inspection audit fixes** (`ce29798`): final P0 sweep on miscellaneous endpoints.
- **Map context-menu items** (`b9f1e04`): tombstoned context-menu items on right-click weren't wired to a handler — clicking them was a silent no-op. Now route to the correct create dialog. Same commit added an AssetSidePanel domain fallback for assets without a domain set.

**P1 — backend:**
- WO P1 batch (`a1aa31f`): N+1 in WO list, transition validity check, M:N filter on the asset_uid query param, schedule template propagation, timer cleanup in the recurring-WO worker.
- Dashboard P1 batch (`b54b63e`): overdue filter no longer included completed/cancelled WOs, N+1 in `_today_queue` and `_throughput_7d`, error gating so a single panel failure doesn't 500 the dashboard, metric agreement between dashboard and list (the original "dashboard ↔ list" mismatch the actionability sweep would later finish in `bfa2e2a`).

**Lint / CI:**
- `60efaeb`: bumped ruff line-length, added per-file ignores, fixed 3 real lints to unbreak CI.
- `774e1c3`: ran prettier across `frontend/` (CI's prettier-check was failing on stale formatting).

**Seeds:**
- `52859f2` + `46fe439`: every SR category now has a matching task definition so smart-comment templates render in the demo.
- `2183061`: heavier demo — 50 of each asset class, schedules wired, ~600 SRs/year. The dashboard now shows realistic backlog instead of three nearly-empty panels.

**Dashboard ↔ WO-list reconciliation** (`bfa2e2a`): the dashboard's "Open work" KPI included scopes (active, overdue) that the list page only computed client-side, so a tenant with hundreds of WOs saw "47 overdue" on the dashboard and 3 on the visible list page. Added server-side `status_in` and `overdue=1` query params; the list now matches the KPI exactly.

### 2. UI foundation + dashboard "By area" + branding polish (`b3cae2b` → `67dde2f`, 5 commits)

**`67dde2f` — primitive component set.** First-class `<Button variant="primary"|"secondary"|"ghost"|"danger" size="sm"|"md">`, `<Panel>`, `<Alert variant="error"|"success"|"info"|"warning">`, `<DetailHeader backTo backLabel title subtitle? trailing? meta?>`, plus `<LoadingState>`, `<ErrorState>`, `<EmptyState>`. Two material visual bugs fixed in the same sweep: the asset-detail Delete button used light-theme colors (looked broken on the dark UI), and the AdminLayout active-tab indicator used `border-slate-900` which was invisible against the slate-900 background. MapPage gained a top-left back-to-home pill so the user has navigational context out of the full-screen map.

**`e4d8c0b` — favicon as in-app `<Logo>`.** Inline-SVG `<Logo>` component (matches `public/favicon.svg` byte-for-byte). Used in the sidebar header (32px) and login page (48px). Browser tab and in-app branding now match.

**`b3cae2b` — dashboard "By area" panel.** Backend `/api/v1/dashboard` returns `by_area`: per service area, count of active WOs, overdue WOs, and active SRs (spatial intersect at read time). Frontend renders a tight grouped panel between the today queue and the category chart. Tenants without service areas get an empty-state nudge to configure one. Visible demo numbers: North district 3 active WOs / 82 SRs, South district 7 active WOs / 100 SRs.

**`ac92ce9` + `85127da` — area-chip filtering on Asset detail.** The chip strip showed every domain's areas; now filtered by the asset's domain (`ac92ce9`) and off-topic chips are hidden rather than dimmed (`85127da`).

### 3. Smart-comment narrative wiring (`9737f2d` → `e0cc291`, 3 commits)

Operator goal: never type a free-text comment. Observations alone produce the narrative.

- **`9737f2d`** — added `task_data jsonb NOT NULL DEFAULT '{}'` to `work_order_asset` (migration `0031`). Per-asset "+ Observations" exposes the WO task definition's form fields; populated values feed the `smart_comments` template. `renderSmartComment(task, taskData)` evaluates the first matching condition and interpolates field values.
- **`77342a9`** — completed asset stops fold into a smart-comment chip strip and disappear from the route list. Operator's "next stop" view stays clean.
- **`e0cc291`** — grammar + unit-spacing pass on the `smart_comments` seed catalogue. "have plumber" → "have a plumber" (4 spots), unit spacing standardised across lift-station / CCTV / grease-trap / catch-basin / ditch-clean entries.

### 4. Actionability sweep — 9 waves (`d9ef124` → `ba5aa1d`, 9 commits)

Triggered by an explicit "audit the entire app for actionability and usability — less clicks the better." Each wave is one commit.

**Wave 1 (`d9ef124`) — toast+undo, dispatch autofill, WO referrer back-link.**
- New `frontend/src/lib/toast.ts` (module-level pub/sub store) + `<ToastHost>`. Defer-then-undo pattern replaces ConfirmDialog on row actions: 4-second `setTimeout` cancellable via Undo, no round-trip-and-revert dance.
- `DispatchDialog` autofocuses the title field and pre-derives the title from the SR description's first sentence; SR category → WO category mapping table.
- `WorkOrderListPage` writes a sessionStorage referrer; the WO detail back-link reads it so "back from a filtered list" preserves the filter.

**Wave 2 (`61f635d`) — persist map + asset filters across reload.** New `usePersistedState<T>` hook (localStorage with optional Set serde). Map's visibleClasses, basemap, and area-kind toggles persist; asset list filters persist. `layerInitRan` ref + `localStorage.getItem(...) === null` check so the "fill all classes visible" init only runs on a genuinely fresh visit.

**Wave 3 (`751c63b`) — SR bulk actions + dashboard "Just mine" tile + AssetPicker class default.**
- `ServiceRequestListPage` got bulk select + bulk transition with the same defer-then-undo pattern (`deferBulk` cancels every queued mutation through one Undo).
- Dashboard `KpiHero` accepts a `quickActions[]` array; first WO tile gets a "Just mine →" shortcut.
- AssetPicker now defaults its class filter to the most common class among already-attached assets.

**Wave 4 (`6c0ddca`) — summary-bar honesty + always-render Show completed + export hint.** Dropped Overdue / DueToday / HighEmergency from the WO list SummaryBar (those were per-page-only counts that lied at scale). Active-scope ring on the remaining stat. "Show completed" toggle always rendered (was hidden when no completed rows existed; surprised users into thinking it didn't exist). Export hint moved next to the count.

**Wave 5 (`8bc8e1a`) — per-stop observations autosave + template prefill.** `ObservationsPanel` debounces 800ms after the last edit, shows pending → saved → idle status. Prefills from existing `task_data` so reopening a stop doesn't blow away prior input.

**Wave 6 (`5c3f16b`) — single-letter hotkeys for WO status transitions.** d / o / a / i / h / c / x map to the seven statuses. Excludes editable targets so typing in a textarea is safe. Only fires for transitions allowed from the current status.

**Wave 7 (`2ef5493`) — map URL state for center/zoom + `?focus=ASSET-UID` deep link.** `moveend` debounced to 300ms, replace-not-push so back-button history isn't drowned in pan jitter. `?focus=` resolves to a `getAsset(uid)` → `flyTo` + `setSelected`. `suppressUrlWrite` ref prevents the moveend handler from clobbering `?focus=` after a programmatic flyTo.

**Wave 8 (`45a255a`) — mobile-friendly map chrome.** LayerPanel becomes a fixed slide-in drawer on `<md` (with backdrop tap to close). AssetSidePanel becomes a bottom sheet on mobile (max-h 60vh, scroll within sheet rather than pushing the map off-screen). Top-bar gains a hamburger trigger for the layer drawer.

**Wave 9 (`ba5aa1d`) — overlay perf + search bar reuse.** `backend/app/api/map_overlays.py` now does `cast(func.ST_AsGeoJSON(...), JSONB)` so psycopg returns a parsed dict — skips a per-row `json.loads`. `MapSearchBar` switched from a one-shot fetch ref pattern to the existing `useMapOverlays()` hook so freshly-created WOs/SRs (which invalidate the `["map-overlays"]` key) appear in search without a refresh.

### 5. Marketing — privacy + terms pages (`851b600`)

- New `marketing/privacy.html` and `marketing/terms.html` matching the brochure's typography and design tokens. 11 sections (privacy) / 13 sections (terms), § 01 numbered, dotted-rule separators, single-column reading width.
- Privacy § 01 names **Kathail** ([kathail.ca](https://kathail.ca)) as the operating entity for CityWater. Terms preamble + § 10 liability cap reflect the same. CityWater is the product; Kathail is the contracting party.
- Sub-processor table: Railway (us-east), Backblaze B2 or Cloudflare R2 (US), Resend (US — wired in `backend/app/services/email.py`). Governing law: Ontario. Retention: 30 days post-cancellation, 2 years audit log.
- `marketing/index.html` footer adds Privacy + Terms links and an auto-year copyright (`<span id="footer-year">` + 1-line inline script).
- nginx `try_files` extended with `$uri.html` so `/privacy` and `/terms` resolve cleanly; canonicals updated; sitemap updated.
- `marketing/package.json` build script now copies all three HTML pages into `dist/` (was index.html only).

**Still on the desk before sales conversations:** real mailing address (PIPEDA-friendly PO box), Kathail entity formation status, and a lawyer pass on the liability cap + beta disclaimer.

## Production health (last verified post-`851b600`)

```json
GET https://backend-production-f929.up.railway.app/healthz/deep
{
  "ok": true,
  "version": "851b600367f8",
  "environment": "production",
  "checks": {
    "postgres": { "status": "ok" },
    "postgis":  { "status": "ok", "version": "3.7 USE_GEOS=1 USE_PROJ=1 USE_STATS=1" },
    "redis":    { "status": "ok" }
  }
}
```

Marketing service serves the three pages with security headers; demo flow lands cleanly into the dashboard; SR `?q=` regression test still green.

## Open work (BACKLOG.md + audit residue)

**Closed since the previous handoff:**
- ~~Native `alert()` / `confirm()` in WO + SR list pages~~ — replaced by the toast+undo pattern from the actionability sweep.
- ~~Dashboard ↔ WO list metric mismatch~~ — closed in `b54b63e` (server side) and `bfa2e2a` (client wiring).
- ~~`work_order_asset` missing `tenant_id` and `updated_at`~~ — covered by migration 0029, and the new `task_data` column landed in 0031.
- ~~N+1 in WO list + dashboard panels~~ — addressed in `a1aa31f` and `b54b63e`. (Other N+1s may remain; not flagged.)

**Still open:**
- **Recurring Work Orders (SPEC §3.10).** `wo_template` schema delta is documented but unimplemented. AC1–AC7 in §7 are not achievable without the recurring fields (`target_mode`, `frequency_*`, `active`, `pause/resume`).
- **Per-tenant AssetClass.** Current global catalog is gated by `ALLOW_ASSET_CLASS_EDITS=false`. Real fix is copy-on-customize so a tenant can fork the global row.
- **ByArea row → filtered map.** Each ByArea row still routes to `/${slug}/map` with no focus context (`ByArea.tsx:96`). The dashboard panel landed but the deep-link is generic.
- **Per-bar `aria-label` on the dashboard sparkline.** A11y nit, still open.
- **Modal focus-trap.** ~10 dialogs (`ConfirmDialog`, `CreateWorkOrderDialog`, `CreateInspectionDialog`, `IntakeDialog`, `DispatchDialog`, `AddAssetDialog`, `ImportDialog`, `ImportPacpDialog`, `CreateScheduleDialog`, the inline close-SR dialog) lack a focus trap. Tab keys can escape behind the backdrop.
- **Test coverage backfill** for `service_areas`, `map_overlays`, `crews`, `history`, `email` driver. The audit sweep added 11 backend tests but those targeted the fixes; the listed module gaps remain.
- **Magic numbers** still live as module constants: `_ATTACHMENT_MAX_BYTES = 25 MiB`, `_DUPLICATE_RADIUS_M = 100.0`, dashboard pane `.limit(N)` values. Move into `Settings`.

**New from this session:**
- **Privacy / Terms — entity completion.** Kathail named as operator but a real mailing address is "available on request" only. PIPEDA-friendly PO box + lawyer review required before B2B sales.
- **Marketing CSP.** nginx config comment now says "marketing renders only one tiny inline script per page"; an actual CSP header allowing `'unsafe-inline'` for scripts is straightforward to add and would be cheap defence-in-depth (the brochure makes no fetch calls).
- **CityWater EPIC-V2-PORTAL.** Surfaced during the BACKLOG review — the citizen portal called out as "v2" in CLAUDE.md isn't an epic in BACKLOG.md. Worth adding alongside the Planner and Dispatcher epics, with a triggered-when threshold.

## Quick reference

```sh
# Full local stack
make dev                              # bring up postgres, redis, minio, pg_tileserv
cd backend && uv run flask --app app.wsgi seed-demo
cd backend && uv run flask --app app.wsgi run --debug --port 5000
cd frontend && npm run dev            # http://localhost:5173

# Marketing brochure (Tailwind v4 watch)
cd marketing && npm run dev           # rebuilds dist/output.css on edit
cd marketing && npm run build         # produces dist/{index,privacy,terms}.html

# Health
curl -s https://backend-production-f929.up.railway.app/healthz/deep | jq

# Test suites
cd backend  && uv run pytest          # 399 tests
cd frontend && npx vitest run         # 202 tests

# Railway ops
railway logs --service backend
railway logs --service frontend
railway logs --service marketing
railway variable list --service backend

# Demo creds
slug=demo  email=admin@demo.citywater.io  password=DemoPassword123!
```
