from __future__ import annotations

import io
import os
from datetime import UTC, datetime, timedelta

import pytest

from app.extensions import db
from tests.conftest import login_client, make_asset, make_tenant, make_user


def _create_wo(client, **overrides) -> dict:
    payload = {"title": "Test WO", "type": "reactive", "category": "repair"}
    payload.update(overrides)
    resp = client.post("/api/v1/work-orders", json=payload)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def test_create_work_order_basic(admin_client):
    body = _create_wo(admin_client)
    assert body["wo_number"].startswith("WO-")
    assert body["status"] == "draft"
    assert body["title"] == "Test WO"


def test_create_from_asset(admin_client, tenant):
    _ = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-WO1")
    db.session.commit()
    body = _create_wo(admin_client, asset_uid="HYD-WO1", title="Inspect HYD-WO1")
    assert body["asset_uid"] == "HYD-WO1"


def test_create_unknown_asset_uid_422(admin_client):
    resp = admin_client.post(
        "/api/v1/work-orders",
        json={"title": "x", "asset_uid": "NOPE-99"},
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "unknown_asset"


def test_wo_number_per_tenant_per_year(admin_client):
    a = _create_wo(admin_client)
    b = _create_wo(admin_client)
    assert a["wo_number"] != b["wo_number"]
    year = datetime.now(UTC).year
    assert a["wo_number"].startswith(f"WO-{year}-")
    assert b["wo_number"].startswith(f"WO-{year}-")


def test_get_work_order(admin_client):
    body = _create_wo(admin_client, title="Lookup")
    resp = admin_client.get(f"/api/v1/work-orders/{body['wo_number']}")
    assert resp.status_code == 200
    assert resp.get_json()["title"] == "Lookup"


def test_list_filters_and_pagination(admin_client):
    for i in range(3):
        _create_wo(admin_client, title=f"WO {i}")
    body = admin_client.get("/api/v1/work-orders?page_size=2").get_json()
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["items"]) == 2
    assert body["total"] >= 3


def test_filter_by_status(admin_client):
    a = _create_wo(admin_client)
    admin_client.post(f"/api/v1/work-orders/{a['wo_number']}/transition", json={"to": "open"})
    body = admin_client.get("/api/v1/work-orders?status=open").get_json()
    assert all(w["status"] == "open" for w in body["items"])


def test_filter_assigned_to_me(admin_client, admin_user):
    body = _create_wo(admin_client, assigned_to=admin_user.id)
    listing = admin_client.get("/api/v1/work-orders?assigned_to=me").get_json()
    assert any(w["wo_number"] == body["wo_number"] for w in listing["items"])


def test_legal_transitions_chain(admin_client):
    wo = _create_wo(admin_client)
    n = wo["wo_number"]
    for to in ("open", "assigned", "in_progress", "completed"):
        resp = admin_client.post(f"/api/v1/work-orders/{n}/transition", json={"to": to})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["status"] == to


def test_illegal_transition_409(admin_client):
    wo = _create_wo(admin_client)
    resp = admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/transition",
        json={"to": "completed"},
    )
    assert resp.status_code == 409
    assert resp.get_json()["error"]["code"] == "invalid_transition"


def test_completed_terminal(admin_client):
    wo = _create_wo(admin_client)
    n = wo["wo_number"]
    for to in ("open", "assigned", "in_progress", "completed"):
        admin_client.post(f"/api/v1/work-orders/{n}/transition", json={"to": to})
    resp = admin_client.post(f"/api/v1/work-orders/{n}/transition", json={"to": "open"})
    assert resp.status_code == 409


def test_in_progress_sets_started_at(admin_client):
    wo = _create_wo(admin_client)
    n = wo["wo_number"]
    for to in ("open", "assigned", "in_progress"):
        admin_client.post(f"/api/v1/work-orders/{n}/transition", json={"to": to})
    body = admin_client.get(f"/api/v1/work-orders/{n}").get_json()
    assert body["started_at"] is not None


def test_completed_sets_completed_at(admin_client):
    wo = _create_wo(admin_client)
    n = wo["wo_number"]
    for to in ("open", "assigned", "in_progress", "completed"):
        admin_client.post(f"/api/v1/work-orders/{n}/transition", json={"to": to})
    body = admin_client.get(f"/api/v1/work-orders/{n}").get_json()
    assert body["completed_at"] is not None


def test_add_task_and_complete(admin_client, admin_user):
    wo = _create_wo(admin_client)
    n = wo["wo_number"]
    resp = admin_client.post(f"/api/v1/work-orders/{n}/tasks", json={"title": "Step 1"})
    assert resp.status_code == 201
    task_id = resp.get_json()["id"]

    upd = admin_client.patch(f"/api/v1/work-orders/{n}/tasks/{task_id}", json={"is_complete": True})
    body = upd.get_json()
    assert body["is_complete"] is True
    assert body["completed_at"] is not None


def test_log_time_computes_hours(admin_client):
    wo = _create_wo(admin_client)
    start = datetime.now(UTC) - timedelta(hours=2, minutes=30)
    end = start + timedelta(hours=2, minutes=30)
    resp = admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/time",
        json={"started_at": start.isoformat(), "ended_at": end.isoformat()},
    )
    assert resp.status_code == 201
    assert float(resp.get_json()["hours_decimal"]) == 2.5


def test_log_time_bad_range_422(admin_client):
    wo = _create_wo(admin_client)
    end = datetime.now(UTC)
    start = end + timedelta(hours=1)
    resp = admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/time",
        json={"started_at": start.isoformat(), "ended_at": end.isoformat()},
    )
    assert resp.status_code == 422


def test_log_material_and_total(admin_client):
    wo = _create_wo(admin_client)
    n = wo["wo_number"]
    admin_client.post(
        f"/api/v1/work-orders/{n}/materials",
        json={"description": "bolts", "quantity": "10", "unit_cost": "1.50"},
    )
    admin_client.post(
        f"/api/v1/work-orders/{n}/materials",
        json={"description": "pipe", "quantity": "2", "unit_cost": "5"},
    )
    body = admin_client.get(f"/api/v1/work-orders/{n}").get_json()
    assert float(body["materials_total"]) == 25.0


def test_tech_only_sees_assigned(app, client, tenant, admin_user):
    other = make_user(tenant, email="bob@acme.io", role_codes=["tech"])
    db.session.commit()

    login_client(client, "acme", "admin@acme.io")
    a = client.post(
        "/api/v1/work-orders",
        json={"title": "for-other", "assigned_to": other.id},
    ).get_json()
    b = client.post(
        "/api/v1/work-orders",
        json={"title": "for-admin", "assigned_to": admin_user.id},
    ).get_json()
    client.post("/api/v1/auth/logout")

    login_client(client, "acme", "bob@acme.io")
    listed = client.get("/api/v1/work-orders").get_json()
    uids = {w["wo_number"] for w in listed["items"]}
    assert a["wo_number"] in uids
    assert b["wo_number"] not in uids


def test_tech_cannot_change_assigned(app, client, tenant, admin_user):
    other = make_user(tenant, email="bob@acme.io", role_codes=["tech"])
    db.session.commit()

    login_client(client, "acme", "admin@acme.io")
    wo = client.post(
        "/api/v1/work-orders",
        json={"title": "x", "assigned_to": other.id},
    ).get_json()
    client.post("/api/v1/auth/logout")

    login_client(client, "acme", "bob@acme.io")
    resp = client.patch(
        f"/api/v1/work-orders/{wo['wo_number']}",
        json={"assigned_to": admin_user.id},
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "forbidden_fields"


def test_tech_can_edit_description(app, client, tenant, admin_user):
    other = make_user(tenant, email="bob@acme.io", role_codes=["tech"])
    db.session.commit()
    login_client(client, "acme", "admin@acme.io")
    wo = client.post(
        "/api/v1/work-orders",
        json={"title": "x", "assigned_to": other.id},
    ).get_json()
    client.post("/api/v1/auth/logout")

    login_client(client, "acme", "bob@acme.io")
    resp = client.patch(
        f"/api/v1/work-orders/{wo['wo_number']}",
        json={"description": "found a leak"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["description"] == "found a leak"


def test_cross_tenant_404(app, client, admin_user):
    other = make_tenant(slug="globex", name="Globex Inc")
    make_user(other, email="g@globex.io", role_codes=["admin"])
    db.session.commit()

    login_client(client, "globex", "g@globex.io")
    wo = client.post("/api/v1/work-orders", json={"title": "globex-wo"}).get_json()
    client.post("/api/v1/auth/logout")

    login_client(client, "acme", "admin@acme.io")
    resp = client.get(f"/api/v1/work-orders/{wo['wo_number']}")
    assert resp.status_code == 404


def test_template_create_and_apply(admin_client):
    template = admin_client.post(
        "/api/v1/wo-templates",
        json={
            "name": "Hydrant flush",
            "category": "flushing",
            "default_priority": "normal",
            "task_template": [
                {"title": "Verify isolation", "sequence": 0},
                {"title": "Open hydrant", "sequence": 1},
                {"title": "Flow until clear", "sequence": 2},
            ],
        },
    ).get_json()

    wo = admin_client.post(
        "/api/v1/work-orders",
        json={"title": "Routine flush", "from_template_id": template["id"]},
    ).get_json()

    assert len(wo["tasks"]) == 3
    assert wo["tasks"][0]["title"] == "Verify isolation"


def test_create_crew(admin_client):
    resp = admin_client.post("/api/v1/crews", json={"name": "North side"})
    assert resp.status_code == 201
    assert resp.get_json()["name"] == "North side"


def test_attachment_upload_minio_or_skip(admin_client):
    """Smoke test against moto's mock S3."""
    pytest.importorskip("moto")
    from moto import mock_aws

    with mock_aws():
        os.environ.update(
            {
                "S3_ACCESS_KEY_ID": "test",
                "S3_SECRET_ACCESS_KEY": "test",
                "S3_REGION": "us-east-1",
                "S3_BUCKET": "flowops-test",
            }
        )
        os.environ.pop("S3_ENDPOINT_URL", None)
        from app.services.storage import ensure_bucket

        ensure_bucket()

        wo = _create_wo(admin_client)
        resp = admin_client.post(
            f"/api/v1/work-orders/{wo['wo_number']}/attachments",
            data={
                "kind": "doc",
                "file": (io.BytesIO(b"hello world"), "note.txt"),
            },
            content_type="multipart/form-data",
        )
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body["original_filename"] == "note.txt"
        assert body["size_bytes"] == 11
