"""Tests for the multi-asset endpoints on a work order.

Covers bulk add, remove, per-stop update, sequence assignment, and
duplicate suppression.
"""

from __future__ import annotations

from app.extensions import db
from tests.conftest import make_asset


def _create_wo(client, **overrides) -> dict:
    payload = {"title": "Route WO", "type": "planned", "category": "flushing"}
    payload.update(overrides)
    resp = client.post("/api/v1/work-orders", json=payload)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def test_bulk_add_assets_assigns_sequences(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-1")
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-2")
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-3")
    db.session.commit()

    wo = _create_wo(admin_client)
    resp = admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/assets",
        json={"asset_uids": ["H-1", "H-2", "H-3"]},
    )
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert [a["asset_uid"] for a in body["assets"]] == ["H-1", "H-2", "H-3"]
    assert [a["sequence"] for a in body["assets"]] == [1, 2, 3]
    assert all(a["role"] == "affected" for a in body["assets"])


def test_bulk_add_skips_duplicates(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-A")
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-B")
    db.session.commit()
    wo = _create_wo(admin_client)
    admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/assets",
        json={"asset_uids": ["H-A"]},
    )
    resp = admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/assets",
        json={"asset_uids": ["H-A", "H-B"]},
    )
    body = resp.get_json()
    # H-A already there → only H-B added; H-B gets sequence 2.
    assert [a["asset_uid"] for a in body["assets"]] == ["H-A", "H-B"]
    assert [a["sequence"] for a in body["assets"]] == [1, 2]


def test_bulk_add_unknown_uid_fails(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-X")
    db.session.commit()
    wo = _create_wo(admin_client)
    resp = admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/assets",
        json={"asset_uids": ["H-X", "GHOST-1"]},
    )
    # ValidationError → 422 (project convention; project's own error
    # handler maps ValidationError to 422, not 400).
    assert resp.status_code in (400, 422)
    assert "GHOST-1" in resp.get_json()["error"]["message"]


def test_remove_asset(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-D1")
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-D2")
    db.session.commit()
    wo = _create_wo(admin_client)
    admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/assets",
        json={"asset_uids": ["H-D1", "H-D2"]},
    )
    resp = admin_client.delete(
        f"/api/v1/work-orders/{wo['wo_number']}/assets/H-D1"
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert [a["asset_uid"] for a in body["assets"]] == ["H-D2"]


def test_per_stop_mark_complete(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="H-C1")
    db.session.commit()
    wo = _create_wo(admin_client)
    admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/assets",
        json={"asset_uids": ["H-C1"]},
    )
    resp = admin_client.patch(
        f"/api/v1/work-orders/{wo['wo_number']}/assets/H-C1",
        json={"mark_complete": True, "completion_notes": "flushed 8 min"},
    )
    assert resp.status_code == 200
    asset = next(a for a in resp.get_json()["assets"] if a["asset_uid"] == "H-C1")
    assert asset["completed_at"] is not None
    assert asset["completion_notes"] == "flushed 8 min"

    # Un-mark
    resp = admin_client.patch(
        f"/api/v1/work-orders/{wo['wo_number']}/assets/H-C1",
        json={"mark_complete": False},
    )
    asset = next(a for a in resp.get_json()["assets"] if a["asset_uid"] == "H-C1")
    assert asset["completed_at"] is None
    assert asset["completion_notes"] is None
