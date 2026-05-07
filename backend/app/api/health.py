from __future__ import annotations

import logging

from flask import Blueprint, current_app, jsonify
from sqlalchemy import text

from app.extensions import db

log = logging.getLogger(__name__)

health_bp = Blueprint("health", __name__)


@health_bp.get("/healthz")
def healthz():
    """Lightweight liveness probe — used by Railway healthchecks. Just
    confirms the DB connection responds. Keep this cheap; for deeper
    diagnostics use /healthz/deep."""
    settings = current_app.config["SETTINGS"]
    try:
        db.session.execute(text("SELECT 1"))
        db_status = "ok"
        status_code = 200
    except Exception:
        log.exception("healthz: db check failed")
        db_status = "error"
        status_code = 503
    return jsonify({"db": db_status, "version": settings.effective_git_sha}), status_code


@health_bp.get("/healthz/deep")
def healthz_deep():
    """Operator-facing readiness check. Confirms:
      - DB reachable
      - PostGIS extension installed and reports a version
      - Redis reachable (if RATELIMIT_STORAGE_URI points at one)

    Returns 200 only if every checked subsystem is healthy. Curl this
    after a deploy to verify the stack is wired correctly:

        curl -s https://<backend>/healthz/deep | jq
    """
    settings = current_app.config["SETTINGS"]
    checks: dict[str, dict[str, str]] = {}
    overall_ok = True

    # Postgres
    try:
        db.session.execute(text("SELECT 1"))
        checks["postgres"] = {"status": "ok"}
    except Exception as e:
        log.exception("healthz/deep: postgres check failed")
        checks["postgres"] = {"status": "error", "detail": str(e)[:200]}
        overall_ok = False

    # PostGIS
    try:
        version = db.session.execute(text("SELECT PostGIS_version()")).scalar_one()
        checks["postgis"] = {"status": "ok", "version": str(version)}
    except Exception as e:
        log.exception("healthz/deep: postgis check failed")
        checks["postgis"] = {"status": "error", "detail": str(e)[:200]}
        overall_ok = False

    # Redis (only meaningful when the operator configured a real URI;
    # the in-memory fallback is fine for dev but should never be the
    # production state, so we surface that as a warning).
    storage_uri = current_app.config.get("RATELIMIT_STORAGE_URI", "memory://")
    if storage_uri.startswith("memory://"):
        checks["redis"] = {
            "status": "warning",
            "detail": "RATELIMIT_STORAGE_URI is in-memory; rate limits are per-replica only",
        }
    else:
        try:
            import redis as redis_lib  # type: ignore[import-untyped]

            client = redis_lib.from_url(storage_uri, socket_connect_timeout=2)
            pong = client.ping()
            client.close()
            checks["redis"] = {"status": "ok" if pong else "error"}
            if not pong:
                overall_ok = False
        except Exception as e:
            log.exception("healthz/deep: redis check failed")
            checks["redis"] = {"status": "error", "detail": str(e)[:200]}
            overall_ok = False

    body = {
        "ok": overall_ok,
        "version": settings.effective_git_sha,
        "environment": settings.environment,
        "checks": checks,
    }
    return jsonify(body), 200 if overall_ok else 503
