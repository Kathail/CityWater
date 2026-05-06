# DEPLOY.md — CityWater on Railway

Production deployment for the CityWater app at **`app.citywater.ca`**.

The marketing/brochure site at `citywater.ca` is **out of scope of this repo** — see [§ Brochure site](#brochure-site) for placement options.

---

## Architecture

```
                      ┌────────────────────────────┐
  app.citywater.ca ─► │  Railway "frontend" service │
   (custom domain)    │   nginx + Vite build        │
                      │   /api/* → backend          │
                      └────────────────────────────┘
                                    │ private net
                                    ▼
                      ┌────────────────────────────┐
                      │  Railway "backend" service  │
                      │   gunicorn → Flask          │
                      └────────────────────────────┘
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
          ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
          │  Postgres     │ │   Redis       │ │  Cron jobs    │
          │  (PostGIS)    │ │ (Flask-Limiter│ │  schedules,   │
          │   plugin      │ │  + RQ later)  │ │  geocode tick │
          └───────────────┘ └───────────────┘ └───────────────┘
```

**Same-origin design**: `app.citywater.ca` serves both the SPA and the `/api` endpoints (nginx proxies `/api/*` to the backend over Railway's private network). This keeps `SameSite=Lax` cookies working without any CORS gymnastics, and keeps the public attack surface to one hostname.

File storage: S3-compatible (Backblaze B2 or Cloudflare R2 — pick one — see env vars below). Files are uploaded directly to the bucket via the backend; download URLs are presigned per-request, so the bucket itself stays private.

---

## Services to create in Railway

A single Railway **project** with these services:

1. **`backend`** — Dockerfile build from `backend/`. Railway uses the `[deploy]` block in `infra/railway.toml` for start command + healthcheck.
2. **`frontend`** — Dockerfile build from `frontend/`. nginx serves the Vite build; envsubst expands `nginx.conf.template` at start using `BACKEND_URL` and `PORT`.
3. **`postgres`** — Railway's Postgres plugin. *Important:* enable the **PostGIS** extension. Either add it to the database via `psql -c "CREATE EXTENSION postgis;"` once, or rely on the first migration to do it (it does — see `0001_initial.py`).
4. **`redis`** — Railway's Redis plugin. Used by Flask-Limiter for rate limiting; will host RQ when background jobs ship.
5. **`cron-schedules`** — Cron service running `flask --app app.wsgi schedules tick` every 5 min.
6. **`cron-geocode`** — Cron service running `flask --app app.wsgi geocode tick` every 1 min.

Both cron services use the same image as the backend; only the start command differs. In the Railway dashboard set them to share the backend's environment.

---

## Environment variables

### `backend` service

| Var | Value | Notes |
|---|---|---|
| `ENVIRONMENT` | `production` | Enables `Secure` cookies + HSTS |
| `SECRET_KEY` | _generate, 64+ random chars_ | `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `DATABASE_URL` | _injected by Postgres plugin_ | Confirm dialect prefix is `postgresql+psycopg://` (rewrite if needed) |
| `REDIS_URL` | _injected by Redis plugin_ | |
| `LOG_LEVEL` | `INFO` | Railway captures stdout |
| `WEB_CONCURRENCY` | `2` | Bump for paid plans |
| `PUBLIC_BASE_URL` | `https://app.citywater.ca` | Used by invitation emails |
| `EMAIL_PROVIDER` | `resend` | Or keep `stdout` until email is needed |
| `RESEND_API_KEY` | _from resend.com_ | Required if `EMAIL_PROVIDER=resend` |
| `EMAIL_FROM` | `CityWater <noreply@citywater.ca>` | Verify the sending domain in Resend |
| `S3_ENDPOINT_URL` | per provider | B2: `https://s3.us-west-002.backblazeb2.com` (region-dependent). R2: `https://<acct>.r2.cloudflarestorage.com` |
| `S3_REGION` | per provider | B2: `us-west-002` etc. R2: `auto` |
| `S3_ACCESS_KEY_ID` | _from provider_ | |
| `S3_SECRET_ACCESS_KEY` | _from provider_ | |
| `S3_BUCKET` | `citywater-attachments` | Create the bucket in the provider console first |
| `GIT_SHA` | injected by Railway | Surfaces in `/healthz` for sanity checks |

### `frontend` service

| Var | Value | Notes |
|---|---|---|
| `BACKEND_URL` | `http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}` | Railway's variable-reference syntax — points at the backend over the private network |
| `PORT` | injected | nginx binds to this |

The `BACKEND_URL` value uses Railway's [shared variables](https://docs.railway.app/guides/variables#reference-variables) — adjust if your services have different names than `backend`.

### `cron-schedules` / `cron-geocode` services

Same env as `backend`. Cron command override:

- `cron-schedules`: `flask --app app.wsgi schedules tick`  ·  schedule `*/5 * * * *`
- `cron-geocode`:  `flask --app app.wsgi geocode tick`     ·  schedule `* * * * *`

---

## Custom domain setup

In the Railway dashboard, on the **`frontend`** service:

1. **Settings → Networking → Custom Domain** → `app.citywater.ca`.
2. Railway shows a CNAME target (something like `xyz.up.railway.app`). Add a CNAME record in your DNS for `app` → that target.
3. Wait for DNS propagation (usually < 5 min). Railway provisions a Let's Encrypt cert automatically; the dashboard shows when it's ready.
4. Hit `https://app.citywater.ca/healthz` — should return `{"db":"ok","version":"<git_sha>"}`.

**Do not** set a custom domain on the backend service. It should remain reachable only via Railway's private network. If you accidentally expose it publicly, the cookies will still scope to `app.citywater.ca`, but you'll have a second public attack surface for no benefit.

---

## First-deploy checklist

1. Create the Railway project, add all services + plugins above.
2. Set env vars per the table.
3. Deploy backend first; check `/healthz` over Railway's auto-generated subdomain. Migrations run on startup (`flask db upgrade`); they should apply 0001–0028.
4. Deploy frontend; verify nginx is up via Railway's subdomain.
5. Add the custom domain `app.citywater.ca`; wait for cert.
6. From your machine: `curl https://app.citywater.ca/healthz` should return JSON, and the SPA should load at the root.
7. Register a real tenant via `/register` (the `/register` route is rate-limited at 5/min — adjust in env if needed for bulk testing).
8. Optionally seed the demo tenant for the "Try the demo →" button:
   ```
   railway run --service backend flask --app app.wsgi seed-demo
   railway run --service backend flask --app app.wsgi simulate-year
   ```

---

## Things that change for production behaviour

These already shipped in the codebase but are worth knowing about:

- **`ProxyFix`** wraps the WSGI app so `request.remote_addr`, `request.is_secure`, and `request.url_scheme` reflect the original client request rather than Railway's proxy. Without it, rate-limit + audit-log IPs would all be Railway's edge, and HSTS / Secure cookies would never engage. (`backend/app/__init__.py`)
- **HSTS** ships with `max-age=31536000; includeSubDomains` once the request is detected as HTTPS or `ENVIRONMENT=production`. **No `preload`** by default — opt-in deliberately, since preload is a one-way commitment.
- **CSP** is tight: `connect-src 'self'`, no third-party scripts. Same-origin frontend → backend means no exception needed for an API host.
- **Cookies**: `Secure`, `HttpOnly`, `SameSite=Lax`, scoped to `app.citywater.ca` (Flask's default — no explicit `SESSION_COOKIE_DOMAIN` required for single-host).

---

## Brochure site

The marketing site at `citywater.ca` should live in **a separate repo** with **a separate hosting target**, for three reasons: (1) it'll iterate on a different cadence than the app; (2) marketing wants to push HTML changes without triggering app deploys; (3) keeping the brochure off the same origin as the app is a (small) defence-in-depth win.

Practical options, ranked by simplest-first:

1. **Cloudflare Pages** or **Netlify** with a static-site generator (Astro, Eleventy). DNS: `citywater.ca` apex → Pages/Netlify per their instructions. ~10 minutes once content exists.
2. **GitHub Pages** with a Jekyll/Astro repo. Free; reasonable for a brochure that updates rarely.
3. **A third Railway service** in this same project. Possible but conflates concerns; not recommended.

Whichever option, configure DNS so that `citywater.ca` (apex + `www`) → brochure host, and `app.citywater.ca` → Railway. Since the apex is on a different host than `app.`, the Cookie scope (`app.citywater.ca`) means brochure visits never see the app session. Good.

If you ever need a "Sign in" link in the brochure that lands users on the app, point it at `https://app.citywater.ca/login` — same-origin within the app, cross-origin from the brochure (which is fine, it's a navigation, not an XHR).

---

## Operational notes

- **Logs**: Railway captures stdout. The backend emits one structured-JSON line per request via `app/security.py::_log_request`. Searchable in the Railway dashboard.
- **Migrations**: every deploy runs `flask db upgrade`. Reversible migrations only — never rely on a non-reversible migration in CI. CLAUDE.md's two-phase rollout rule applies for column drops.
- **Backups**: Railway Postgres has automatic daily backups on paid plans. There's also `infra/backup.sh` for manual `pg_dump` against the production URL — run from a trusted machine, not in CI.
- **Secrets rotation**: `SECRET_KEY` rotation invalidates every active session (acceptable for low-traffic v1; revisit when MAU grows). S3 credentials rotate independently — generate a new key in the provider, update the Railway env, redeploy backend.
- **Rolling deploys**: Railway does zero-downtime deploys by default. Migrations run before the new revision starts, so a failing migration leaves the old revision serving — desired behaviour.

---

## Open questions for the operator

These aren't blockers for first deploy but should get a decision soon:

- **File storage provider**: Backblaze B2 vs Cloudflare R2. R2 has free egress (good for image-heavy attachments); B2 is cheaper at-rest. Pick before the first real attachment is uploaded — moving buckets later means re-keying every `s3_key` row.
- **Backup retention beyond Railway's defaults**: if the Railway plan's retention isn't enough, add an off-Railway nightly `pg_dump` to a separate object store (B2/R2 cold tier).
- **Email provider**: `EMAIL_PROVIDER=stdout` is fine until invitations are mailed. Resend is wired and accepts a `noreply@citywater.ca` sender once the SPF/DKIM records are added — those are the same DNS account hosting `citywater.ca`.
- **Worker for RQ**: not needed yet. When background jobs ship (e.g. for batch CSV import or report generation), add an `rq-worker` service running `rq worker --url $REDIS_URL default`.
