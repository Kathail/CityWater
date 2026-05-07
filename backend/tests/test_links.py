from __future__ import annotations

from datetime import UTC, datetime

from flask import g

from app.extensions import db
from app.models import Inspection, ServiceRequest, WorkOrder
from app.services.geometry import geojson_to_wkb


def _make_wo(tenant, *, title="WO"):
    g.skip_tenant_filter = True
    from app.services.wo_number import next_wo_number

    n = next_wo_number(tenant_id=tenant.id)
    wo = WorkOrder(
        tenant_id=tenant.id,
        wo_number=n,
        type="reactive",
        category="repair",
        priority="normal",
        status="open",
        title=title,
    )
    db.session.add(wo)
    db.session.commit()
    return wo


def _make_sr(tenant, *, sr_number=None):
    g.skip_tenant_filter = True
    n = sr_number or f"SR-{datetime.now(UTC).year}-X{int(datetime.now(UTC).timestamp() * 1000) % 999:03d}"
    sr = ServiceRequest(
        tenant_id=tenant.id,
        sr_number=n,
        category="no_water",
        domain="water",
        priority="normal",
        status="new",
        reported_at=datetime.now(UTC),
        location=geojson_to_wkb({"type": "Point", "coordinates": [-76.5, 39.3]}),
    )
    db.session.add(sr)
    db.session.commit()
    return sr


def _make_ins(tenant, *, kind="manhole"):
    g.skip_tenant_filter = True
    from app.services.inspection_number import next_inspection_number

    n = next_inspection_number(tenant_id=tenant.id)
    ins = Inspection(
        tenant_id=tenant.id,
        inspection_number=n,
        kind=kind,
        performed_at=datetime.now(UTC),
        data={},
    )
    db.session.add(ins)
    db.session.commit()
    return ins


def test_create_link_wo_to_sr(admin_client, tenant):
    wo = _make_wo(tenant, title="Main break")
    sr = _make_sr(tenant)
    resp = admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "work_order",
            "source_id": wo.id,
            "target_type": "service_request",
            "target_id": sr.id,
            "kind": "related",
            "note": "Caller #2 of 50",
        },
    )
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert body["source_ref"] == wo.wo_number
    assert body["target_ref"] == sr.sr_number


def test_link_self_link_rejected(admin_client, tenant):
    wo = _make_wo(tenant)
    resp = admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "work_order",
            "source_id": wo.id,
            "target_type": "work_order",
            "target_id": wo.id,
            "kind": "parent_of",
        },
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "self_link"


def test_link_unknown_target_404(admin_client, tenant):
    wo = _make_wo(tenant)
    resp = admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "work_order",
            "source_id": wo.id,
            "target_type": "service_request",
            "target_id": 99999,
            "kind": "related",
        },
    )
    assert resp.status_code == 404


def test_duplicate_link_rejected(admin_client, tenant):
    wo = _make_wo(tenant)
    sr = _make_sr(tenant)
    payload = {
        "source_type": "work_order",
        "source_id": wo.id,
        "target_type": "service_request",
        "target_id": sr.id,
        "kind": "related",
    }
    a = admin_client.post("/api/v1/links", json=payload)
    assert a.status_code == 201
    b = admin_client.post("/api/v1/links", json=payload)
    assert b.status_code == 409


def test_list_links_matches_either_side(admin_client, tenant):
    wo = _make_wo(tenant)
    sr1 = _make_sr(tenant)
    sr2 = _make_sr(tenant)
    admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "work_order",
            "source_id": wo.id,
            "target_type": "service_request",
            "target_id": sr1.id,
            "kind": "related",
        },
    )
    # Also a SR→WO link to make sure the list captures the WO from either side
    admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "service_request",
            "source_id": sr2.id,
            "target_type": "work_order",
            "target_id": wo.id,
            "kind": "caused_by",
        },
    )
    resp = admin_client.get(f"/api/v1/links?entity_type=work_order&entity_id={wo.id}")
    body = resp.get_json()
    assert len(body["items"]) == 2


def test_link_inspection_to_wo_and_back(admin_client, tenant):
    wo = _make_wo(tenant)
    ins = _make_ins(tenant)
    resp = admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "inspection",
            "source_id": ins.id,
            "target_type": "work_order",
            "target_id": wo.id,
            "kind": "caused_by",
        },
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["source_ref"] == ins.inspection_number


def test_parent_child_wo_links(admin_client, tenant):
    parent = _make_wo(tenant, title="Big job")
    child_a = _make_wo(tenant, title="Sub-job A")
    child_b = _make_wo(tenant, title="Sub-job B")
    for child in (child_a, child_b):
        resp = admin_client.post(
            "/api/v1/links",
            json={
                "source_type": "work_order",
                "source_id": parent.id,
                "target_type": "work_order",
                "target_id": child.id,
                "kind": "parent_of",
            },
        )
        assert resp.status_code == 201
    listed = admin_client.get(f"/api/v1/links?entity_type=work_order&entity_id={parent.id}").get_json()
    assert len(listed["items"]) == 2
    assert all(i["kind"] == "parent_of" for i in listed["items"])


def test_delete_link_soft_deletes(admin_client, tenant):
    wo = _make_wo(tenant)
    sr = _make_sr(tenant)
    create = admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "work_order",
            "source_id": wo.id,
            "target_type": "service_request",
            "target_id": sr.id,
            "kind": "related",
        },
    )
    link_id = create.get_json()["id"]
    delete = admin_client.delete(f"/api/v1/links/{link_id}")
    assert delete.status_code == 204
    # And re-creating the same link should now work because the soft-deleted
    # one is filtered by the partial-unique index.
    again = admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "work_order",
            "source_id": wo.id,
            "target_type": "service_request",
            "target_id": sr.id,
            "kind": "related",
        },
    )
    assert again.status_code == 201


def test_cross_tenant_link_404(admin_client, app, tenant):
    """Try to link from tenant A's WO to tenant B's SR — should 404."""
    from tests.conftest import make_tenant

    g.skip_tenant_filter = True
    other = make_tenant(slug="other-co", name="Other")
    db.session.commit()
    other_sr = _make_sr(other, sr_number=f"SR-{datetime.now(UTC).year}-99999")

    wo = _make_wo(tenant)
    resp = admin_client.post(
        "/api/v1/links",
        json={
            "source_type": "work_order",
            "source_id": wo.id,
            "target_type": "service_request",
            "target_id": other_sr.id,
            "kind": "related",
        },
    )
    # The tenant filter listener excludes the other tenant's SR from
    # `db.session.get(...)`, so the verify_entity check returns NotFound.
    assert resp.status_code == 404


def test_unauthenticated_links_list_401(client):
    resp = client.get("/api/v1/links?entity_type=work_order&entity_id=1")
    assert resp.status_code == 401
