# Handoff — resume point after Sprint 8

Last commit on `main` should be the upcoming `feat: sprint 8 service requests` once squash-merged.
Pushed to: `https://github.com/Kathail/CityWater`

## Where the project stands

| Sprint | Status | Highlights |
|---|---|---|
| S0 | ✅ done | Repo scaffold, Docker compose, /healthz, CI |
| S1 | ✅ done | Auth, tenancy, RBAC, audit log listener |
| S2 | ✅ done | Asset catalog (23 classes seeded), asset CRUD, OpenAPI codegen |
| S3 | ✅ done | Asset map (MapLibre + ST_AsMVT tiles), layer panel, basemap selector |
| S4 | ✅ done | CSV + GeoJSON import/export, streaming, 1000-row perf check |
| S5 | ✅ done | Work orders + tasks/time/materials/attachments (boto3 + EXIF), Kanban (@dnd-kit), templates |
| S6 | ✅ done | Inspections (5 non-CCTV kinds): hydrant flow w/ NFPA 291 server-side calc, valve, MH, CB, lift station |
| S7 | ✅ done | CCTV / PACP — code catalog, WinCan XML+JSON import, observation table |
| S8 | ✅ done | Service requests — intake, triage, dispatch → WO, ST_DWithin duplicate detection, Nominatim geocode stub |
| **S9** | **next** | Reports (5 canned reports, JSON/CSV/PDF) |
| S10 | pending | Field PWA (service worker, IDB cache, mutation queue) |
| S11 | pending | Admin & polish (user invites, schema editor) |
| S12 | pending | Hardening (rate limits, CSP, backups, runbooks) |

## Tests passing

- **Backend: 196** (`cd backend && uv run pytest`)
- **Frontend: 28** (`cd frontend && npm test`)
- All migrations 0001–0018 apply cleanly.

## Resume workflow

```sh
# 1. From repo root, make sure Postgres + dev stack are up
sudo systemctl start postgresql        # if not running
make dev                               # docker-compose stack — only needed if you want MinIO/Redis/pg_tileserv too

# 2. Backend
cd backend
uv sync                                # pulls any new deps
uv run flask --app app.wsgi db upgrade # apply pending migrations (none currently)
uv run flask --app app.wsgi run --debug --no-reload --port 5000 --host 127.0.0.1 &

# 3. Frontend
cd ../frontend
npm install
npm run dev &

# 4. Open http://127.0.0.1:5173 — login or /register
```

## Memory hooks for the next session

The `~/.claude/projects/.../memory/` directory has these standing preferences saved:

- **`feedback_persistent_dev_stack.md`** — keep backend + Vite running between actions, don't ask
- **`feedback_best_practice_always.md`** — standing approval to layer in best-practice additions on top of plan defaults; don't re-ask each sprint
- **`feedback_git_config_rule.md`** — when user provides identity values, set local-repo git config and proceed
- **`user_git_identity.md`** — commits as `Kathail` / GitHub noreply email

Resume cycle: post S8 plan → user says any go-ahead phrase ("approved", "go", "use best practice", "continue") → implement.

## Sprint 8 — Service requests (next)

Per `docs/SPEC.md` §9 (S8) and Epic 5 acceptance.

**Migration**
- `0018_create_service_request` — table per §3.7: `id, tenant_id, sr_number (UNIQUE per tenant), category, domain, status, priority, reported_at, caller_name/phone/email, address, location POINT 4326, description, intake_user_id, work_order_id?, closed_at, closure_notes, attrs, timestamps, deleted_at`. CHECK on `category, domain, status, priority` enums. Indexes: `(tenant_id, status) WHERE deleted_at IS NULL`, `(tenant_id, location) GIST`.

**Endpoints**
- `GET /api/v1/service-requests` — list with `?status, category, domain, since, q, page` filters
- `POST /api/v1/service-requests` — intake creates SR (any role with create permission; intake role primarily)
- `GET /api/v1/service-requests/{sr_number}`
- `PATCH /api/v1/service-requests/{sr_number}` — triage / closure
- `POST /api/v1/service-requests/{sr_number}/dispatch` `{work_order: {…}}` — creates a linked WorkOrder, sets SR status to `dispatched`

**SR number format**: `SR-YYYY-NNNNN` per (tenant, year), retry-on-collision (mirror `WO-` and `INS-` patterns).

**Reverse-geocode**: §10 Q1 default Nominatim. Implement a service stub that takes an address, calls Nominatim if `NOMINATIM_URL` env is set, returns lon/lat. If unset, requires the intake form to provide coords manually. Real Nominatim wiring can land in S11.

**Duplicate detection** (Epic 5): on create, run `ST_DWithin(location, new_location, 100m) AND reported_at within 7 days` and return a list of likely duplicates in the response (don't block; warn).

**Frontend** — `features/service-requests/`:
- `ServiceRequestListPage` with status/category/domain filters
- `ServiceRequestDetailPage` with caller info, location, timeline, "Dispatch as work order" button
- `IntakeDialog` — one-step form for service intake (caller name/phone, address, category, domain, description); reverse-geocodes on submit if address provided
- Sidebar: "Service requests" nav link

**Tests** (~12 backend, ~2 frontend):
- Each role's create permission per §6 matrix
- SR-YYYY-NNNNN numbering, dispatch creates WO + transitions SR
- Duplicate detection returns nearby recent SRs
- Cross-tenant 404
- IntakeDialog renders + submits

## Outstanding spec deviations (already in docs/SPEC.md but worth re-checking)

- §3.1 user table includes `user_uid` — tracked
- §4 login takes `tenant_slug` — tracked
- §10 Q6 (tenant URL strategy) — resolved → subpath
- PACP code seed is a representative subset; NASSCO licensing required for full set
- Vite dev server pinned to `127.0.0.1` for IPv4 (Node 25 was selecting `::1`)

## Local DB state

Migrations applied through `0017_pacp_code`. The `test-city` tenant from earlier testing still has its admin user (email `test@testing.com` per the user's recall). To reset:

```sh
PGPASSWORD=flowops psql -h localhost -U flowops -d flowops -c "
DELETE FROM \"user\" WHERE tenant_id IN (SELECT id FROM tenant);
DELETE FROM tenant;
"
```

Or recreate from scratch:
```sh
PGPASSWORD=flowops psql -h localhost -U flowops -d postgres -c "DROP DATABASE flowops;"
PGPASSWORD=flowops psql -h localhost -U flowops -d postgres -c "CREATE DATABASE flowops OWNER flowops;"
cd backend && uv run flask --app app.wsgi db upgrade
```

## Things to know going in

- The dev stack is expected to be up before each session (memory rule). `pkill -f "flask --app"` and restart if backend is stale after backend code changes.
- All sprint work has been **squash-merged** to `main` with original commits preserved on `feat/sprint-N-…` branches on GitHub.
- Bundle is split: auth+assets+work-orders+inspections at ~97 KB gzipped, map chunk at ~290 KB gzipped (lazy on `/map`).
- The OpenAPI spec at `/api/v1/openapi.json` is auto-generated from Pydantic schemas; `npm run generate-api` regenerates `frontend/src/api/generated.ts` (currently unused; type defs only — no path coverage in S2 commit).
