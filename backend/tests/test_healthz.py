from __future__ import annotations


def test_healthz_returns_db_ok(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["db"] == "ok"
    assert body["version"] == "test-sha"


def test_healthz_deep_reports_postgis_and_redis(client):
    resp = client.get("/healthz/deep")
    # Test environment uses in-memory rate limiter — that's a "warning",
    # not an "error" — so deep check still returns 200 if Postgres +
    # PostGIS are healthy.
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["checks"]["postgres"]["status"] == "ok"
    assert body["checks"]["postgis"]["status"] == "ok"
    assert "version" in body["checks"]["postgis"]
    assert body["checks"]["redis"]["status"] in {"ok", "warning"}
