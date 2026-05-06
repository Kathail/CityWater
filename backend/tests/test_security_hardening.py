from __future__ import annotations

import pytest
from flask import g
from flask_migrate import upgrade as flask_migrate_upgrade

from app import create_app
from app.config import Settings
from app.extensions import db, limiter
from app.models import AuditLog
from tests.conftest import (
    _PG_PASSWORD,
    DEFAULT_PASSWORD,
    make_tenant,
    make_user,
)

# ---------- security headers + request ID ----------


def test_security_headers_present(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert "Content-Security-Policy" in resp.headers
    assert "default-src 'self'" in resp.headers["Content-Security-Policy"]
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "DENY"
    assert "strict-origin" in resp.headers.get("Referrer-Policy", "")
    assert "geolocation=(self)" in resp.headers.get("Permissions-Policy", "")


def test_request_id_round_trips(client):
    resp = client.get("/healthz", headers={"X-Request-ID": "trace-abc-123"})
    assert resp.headers.get("X-Request-ID") == "trace-abc-123"


def test_request_id_minted_when_absent(client):
    resp = client.get("/healthz")
    rid = resp.headers.get("X-Request-ID")
    assert rid and len(rid) >= 16


def test_hsts_only_when_secure(client):
    # Test client speaks plain HTTP and the env is "test", so HSTS is skipped
    resp = client.get("/healthz")
    assert "Strict-Transport-Security" not in resp.headers


# ---------- rate limiting ----------


@pytest.fixture
def rate_limited_app(postgresql):
    """Rebuild the app with rate limiting enabled. Default test fixture
    disables it globally so unrelated tests don't trip 429s."""
    info = postgresql.info
    url = f"postgresql+psycopg://{info.user}:{_PG_PASSWORD}@{info.host}:{info.port}/{info.dbname}"
    settings = Settings(
        database_url=url,
        environment="dev",  # not "test" → rate limiting on
        git_sha="test-sha",
        rate_limit_login="3 per minute",
    )
    flask_app = create_app(settings)
    flask_app.config["WTF_CSRF_ENABLED"] = False
    with flask_app.app_context():
        flask_migrate_upgrade()
        # Reset the limiter state so previous tests don't leak counts.
        limiter.reset()
        yield flask_app


def test_login_rate_limit_kicks_in(rate_limited_app):
    g.skip_tenant_filter = True
    tenant = make_tenant()
    make_user(tenant, email="ratelimit@acme.io", role_codes=["admin"])
    db.session.commit()

    client = rate_limited_app.test_client()
    body = {
        "tenant_slug": "acme",
        "email": "ratelimit@acme.io",
        "password": DEFAULT_PASSWORD,
    }
    # Limit is "3 per minute". 3 should pass, 4th should 429.
    for _ in range(3):
        resp = client.post("/api/v1/auth/login", json=body)
        assert resp.status_code == 200, resp.get_json()

    # Issue four more — at least one must be 429.
    statuses = []
    for _ in range(4):
        resp = client.post("/api/v1/auth/login", json=body)
        statuses.append(resp.status_code)
    assert 429 in statuses, statuses


# ---------- audit retention cleanup ----------


def test_audit_cleanup_deletes_old_events(admin_client, tenant):
    from datetime import UTC, datetime, timedelta

    g.skip_tenant_filter = True
    old = AuditLog(
        tenant_id=tenant.id,
        user_id=None,
        entity_type="Marker",
        entity_id="ancient",
        action="test",
        occurred_at=datetime.now(UTC) - timedelta(days=400),
    )
    recent = AuditLog(
        tenant_id=tenant.id,
        user_id=None,
        entity_type="Marker",
        entity_id="recent",
        action="test",
        occurred_at=datetime.now(UTC) - timedelta(days=10),
    )
    db.session.add_all([old, recent])
    db.session.commit()

    resp = admin_client.post("/api/v1/admin/audit-log/cleanup?older_than_days=180")
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["deleted"] >= 1

    g.skip_tenant_filter = True
    remaining = db.session.scalars(
        db.select(AuditLog)
        .where(AuditLog.entity_type == "Marker")
        .execution_options(skip_tenant_filter=True, include_deleted=True)
    ).all()
    entity_ids = {a.entity_id for a in remaining}
    assert "ancient" not in entity_ids
    assert "recent" in entity_ids


def test_audit_cleanup_rejects_aggressive_window(admin_client):
    resp = admin_client.post("/api/v1/admin/audit-log/cleanup?older_than_days=7")
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "too_aggressive"


def test_audit_cleanup_admin_only(supervisor_client):
    resp = supervisor_client.post("/api/v1/admin/audit-log/cleanup?older_than_days=180")
    assert resp.status_code == 403


# ---------- email driver ----------


def test_email_driver_default_is_stdout(app):
    """The default driver is StdoutDriver — verify by type, not log capture
    (configure_logging clears root handlers, which makes caplog flaky)."""
    from app.services.email import StdoutDriver, _driver

    with app.app_context():
        assert isinstance(_driver(), StdoutDriver)


def test_email_driver_resend_falls_back_when_unconfigured(app, monkeypatch):
    from app.services.email import StdoutDriver, _driver

    monkeypatch.setattr(app.config["SETTINGS"], "email_provider", "resend", raising=False)
    monkeypatch.setattr(app.config["SETTINGS"], "resend_api_key", "", raising=False)
    with app.app_context():
        # Without a key, the driver factory should log a warning and return
        # the stdout driver rather than a half-initialised Resend client.
        assert isinstance(_driver(), StdoutDriver)


def test_email_driver_picks_resend_when_configured(app, monkeypatch):
    from app.services.email import ResendDriver, _driver

    monkeypatch.setattr(app.config["SETTINGS"], "email_provider", "resend", raising=False)
    monkeypatch.setattr(app.config["SETTINGS"], "resend_api_key", "rs_test_xxx", raising=False)
    with app.app_context():
        assert isinstance(_driver(), ResendDriver)


_ = pytest  # imported for the `pytest.fixture` decorator above
