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
    # The first asset added to a primary-less WO is auto-promoted to
    # `primary` so wo.asset_id stays meaningful (WO-P0-3). Subsequent
    # rows get the requested role (default `affected`).
    assert [a["role"] for a in body["assets"]] == ["primary", "affected", "affected"]
    # And wo.asset_id should now point at H-1 — verify by re-reading the WO.
    detail = admin_client.get(f"/api/v1/work-orders/{wo['wo_number']}").get_json()
    assert detail["asset_uid"] == "H-1"


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
    resp = admin_client.delete(f"/api/v1/work-orders/{wo['wo_number']}/assets/H-D1")
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


def test_create_wo_with_asset_uid_inserts_primary_row(admin_client, tenant):
    """Regression for WO-P0-3: creating a WO with `asset_uid` must also
    insert a `WorkOrderAsset(role='primary')` row so `_list_wo_assets`
    agrees with `wo.asset_id`. Previously the detail page showed
    `Asset: HYD-1` while the route view said "No assets attached"."""
    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-PRIMARY")
    db.session.commit()
    wo = _create_wo(admin_client, asset_uid="HYD-PRIMARY")
    assert wo["asset_uid"] == "HYD-PRIMARY"
    assert len(wo["assets"]) == 1
    assert wo["assets"][0]["asset_uid"] == "HYD-PRIMARY"
    assert wo["assets"][0]["role"] == "primary"
    assert wo["assets"][0]["sequence"] == 1


def test_remove_primary_promotes_next_stop(admin_client, tenant):
    """Regression for WO-P0-3: deleting the primary asset must promote
    the next stop and update `wo.asset_id` so the detail page doesn't
    keep pointing at a row that no longer exists."""
    make_asset(tenant, class_code="WAT_HYD", asset_uid="P-1")
    make_asset(tenant, class_code="WAT_HYD", asset_uid="P-2")
    make_asset(tenant, class_code="WAT_HYD", asset_uid="P-3")
    db.session.commit()
    wo = _create_wo(admin_client)
    admin_client.post(
        f"/api/v1/work-orders/{wo['wo_number']}/assets",
        json={"asset_uids": ["P-1", "P-2", "P-3"]},
    )
    detail = admin_client.get(f"/api/v1/work-orders/{wo['wo_number']}").get_json()
    assert detail["asset_uid"] == "P-1"

    admin_client.delete(f"/api/v1/work-orders/{wo['wo_number']}/assets/P-1")
    detail = admin_client.get(f"/api/v1/work-orders/{wo['wo_number']}").get_json()
    # Successor (P-2 by sequence) becomes primary; wo.asset_id follows.
    assert detail["asset_uid"] == "P-2"
    primary = next(a for a in detail["assets"] if a["role"] == "primary")
    assert primary["asset_uid"] == "P-2"


def test_remove_last_asset_clears_wo_asset_id(admin_client, tenant):
    """Regression for WO-P0-3: removing the only asset on a WO must
    clear wo.asset_id rather than leaving it pointing at a row that's
    been deleted."""
    make_asset(tenant, class_code="WAT_HYD", asset_uid="ONLY-1")
    db.session.commit()
    wo = _create_wo(admin_client, asset_uid="ONLY-1")
    admin_client.delete(f"/api/v1/work-orders/{wo['wo_number']}/assets/ONLY-1")
    detail = admin_client.get(f"/api/v1/work-orders/{wo['wo_number']}").get_json()
    assert detail["asset_uid"] is None
    assert detail["assets"] == []
