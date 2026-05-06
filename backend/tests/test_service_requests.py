from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from flask import g

from app.extensions import db
from app.models import ServiceRequest, Tenant, WorkOrder
from app.services.geometry import geojson_to_wkb
from tests.conftest import login_client, make_tenant, make_user

# Each test uses one test_client. pytest-flask's autouse `_push_request_context`
# keeps a single request context alive across the whole test, which causes
# Flask-Login's `current_user` to leak between distinct `app.test_client()`
# instances. So when a test needs cross-role/cross-tenant assertions, it
# inserts the cross-side rows directly via the DB session and only exercises
# one HTTP-level identity per test.


@pytest.fixture
def intake_client(app, tenant):
    g.skip_tenant_filter = True
    make_user(tenant, email="intake@acme.io", role_codes=["intake"])
    db.session.commit()
    c = app.test_client()
    login_client(c, "acme", "intake@acme.io")
    return c


@pytest.fixture
def readonly_client(app, tenant):
    g.skip_tenant_filter = True
    make_user(tenant, email="ro@acme.io", role_codes=["readonly"])
    db.session.commit()
    c = app.test_client()
    login_client(c, "acme", "ro@acme.io")
    return c


def _intake_payload(**overrides):
    payload = {
        "category": "no_water",
        "domain": "water",
        "priority": "high",
        "caller_name": "Jane Doe",
        "caller_phone": "555-1234",
        "address": "123 Main St",
        "location": {"type": "Point", "coordinates": [-76.5, 39.3]},
        "description": "No water at the kitchen sink since this morning.",
    }
    payload.update(overrides)
    return payload


def _insert_sr(
    tenant: Tenant,
    *,
    sr_number: str | None = None,
    status: str = "new",
    location: tuple[float, float] | None = (-76.5, 39.3),
    reported_at: datetime | None = None,
    **fields: Any,
) -> ServiceRequest:
    g.skip_tenant_filter = True
    if sr_number is None:
        ms = int(datetime.now(UTC).timestamp() * 1000) % 99999
        sr_number = f"SR-{datetime.now(UTC).year}-{ms:05d}"
    loc = None
    if location is not None:
        loc = geojson_to_wkb({"type": "Point", "coordinates": list(location)})
    sr = ServiceRequest(
        tenant_id=tenant.id,
        sr_number=sr_number,
        category=fields.pop("category", "no_water"),
        domain=fields.pop("domain", "water"),
        priority=fields.pop("priority", "normal"),
        status=status,
        reported_at=reported_at or datetime.now(UTC),
        location=loc,
        **fields,
    )
    db.session.add(sr)
    db.session.commit()
    return sr


def test_intake_creates_sr_with_year_numbering(admin_client):
    resp = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    sr = body["service_request"]
    assert sr["sr_number"].startswith(f"SR-{datetime.now(UTC).year}-")
    assert sr["status"] == "new"
    assert sr["category"] == "no_water"
    assert sr["domain"] == "water"
    assert sr["intake_user_id"] is not None
    assert body["duplicates"] == []


def test_intake_role_can_create_and_cannot_dispatch(intake_client):
    create = intake_client.post("/api/v1/service-requests", json=_intake_payload())
    assert create.status_code == 201
    sr_number = create.get_json()["service_request"]["sr_number"]

    dispatch = intake_client.post(
        f"/api/v1/service-requests/{sr_number}/dispatch",
        json={"work_order": {"title": "Investigate"}},
    )
    assert dispatch.status_code == 403, dispatch.get_json()


def test_readonly_cannot_create(readonly_client):
    resp = readonly_client.post("/api/v1/service-requests", json=_intake_payload())
    assert resp.status_code == 403


def test_dispatch_creates_work_order_and_transitions_sr(admin_client):
    create_resp = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    sr_number = create_resp.get_json()["service_request"]["sr_number"]

    dispatch_resp = admin_client.post(
        f"/api/v1/service-requests/{sr_number}/dispatch",
        json={
            "work_order": {
                "title": "Investigate no-water complaint",
                "category": "repair",
                "priority": "high",
            }
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.get_json()
    body = dispatch_resp.get_json()
    assert body["status"] == "dispatched"
    assert body["work_order_number"] is not None

    wo_number = body["work_order_number"]
    wo_resp = admin_client.get(f"/api/v1/work-orders/{wo_number}")
    assert wo_resp.status_code == 200
    wo_body = wo_resp.get_json()
    assert wo_body["title"] == "Investigate no-water complaint"
    assert wo_body["status"] == "open"
    assert wo_body["priority"] == "high"


def test_cannot_dispatch_closed_sr(admin_client):
    create = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    sr_number = create.get_json()["service_request"]["sr_number"]
    close = admin_client.patch(
        f"/api/v1/service-requests/{sr_number}",
        json={"status": "closed", "closure_reason": "no_action"},
    )
    assert close.status_code == 200
    resp = admin_client.post(
        f"/api/v1/service-requests/{sr_number}/dispatch",
        json={"work_order": {"title": "x"}},
    )
    assert resp.status_code == 409


def test_duplicate_detection_returns_nearby_recent(admin_client):
    first = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    assert first.status_code == 201

    payload2 = _intake_payload(location={"type": "Point", "coordinates": [-76.4995, 39.3001]})
    second = admin_client.post("/api/v1/service-requests", json=payload2)
    assert second.status_code == 201
    body = second.get_json()
    assert len(body["duplicates"]) == 1
    assert body["duplicates"][0]["sr_number"] == first.get_json()["service_request"]["sr_number"]
    assert body["duplicates"][0]["distance_m"] < 100


def test_duplicate_detection_window_excludes_old(admin_client, tenant):
    _insert_sr(
        tenant,
        sr_number=f"SR-{datetime.now(UTC).year}-99999",
        reported_at=datetime.now(UTC) - timedelta(days=30),
    )
    resp = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    assert resp.get_json()["duplicates"] == []


def test_list_filters_by_status(admin_client):
    admin_client.post("/api/v1/service-requests", json=_intake_payload())
    admin_client.post("/api/v1/service-requests", json=_intake_payload(category="flooding"))
    resp = admin_client.get("/api/v1/service-requests?status=new")
    body = resp.get_json()
    assert body["total"] == 2
    assert all(item["status"] == "new" for item in body["items"])


def test_list_filter_by_domain_and_category(admin_client):
    admin_client.post("/api/v1/service-requests", json=_intake_payload())
    admin_client.post(
        "/api/v1/service-requests",
        json=_intake_payload(domain="sewer", category="sewer_backup"),
    )
    resp = admin_client.get("/api/v1/service-requests?domain=sewer")
    body = resp.get_json()
    assert body["total"] == 1
    assert body["items"][0]["domain"] == "sewer"


def test_triage_status_change_emits_audit(admin_client, app):
    from sqlalchemy import select as _sel

    from app.models.audit import AuditLog

    create = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    sr_number = create.get_json()["service_request"]["sr_number"]

    resp = admin_client.patch(
        f"/api/v1/service-requests/{sr_number}",
        json={"status": "triaged", "priority": "emergency"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "triaged"

    with app.app_context():
        g.skip_tenant_filter = True
        log = db.session.scalar(
            _sel(AuditLog)
            .where(AuditLog.action == "sr_transition")
            .order_by(AuditLog.id.desc())
            .execution_options(skip_tenant_filter=True, include_deleted=True)
        )
        assert log is not None
        assert log.before["status"] == "new"
        assert log.after["status"] == "triaged"


def test_tech_cannot_change_status(tech_client, tenant):
    sr = _insert_sr(tenant, sr_number=f"SR-{datetime.now(UTC).year}-12345")
    resp = tech_client.patch(
        f"/api/v1/service-requests/{sr.sr_number}",
        json={"status": "triaged"},
    )
    assert resp.status_code == 422


def test_cross_tenant_404(app, admin_client, tenant):
    """Insert an SR into a SECOND tenant directly; the acme admin should 404."""
    g.skip_tenant_filter = True
    other = make_tenant(slug="other", name="Other Co")
    db.session.commit()
    other_sr = _insert_sr(other, sr_number=f"SR-{datetime.now(UTC).year}-77777")
    resp = admin_client.get(f"/api/v1/service-requests/{other_sr.sr_number}")
    assert resp.status_code == 404


def test_address_only_no_geocode_no_dupes(admin_client, monkeypatch):
    monkeypatch.delenv("NOMINATIM_URL", raising=False)
    resp = admin_client.post(
        "/api/v1/service-requests",
        json={
            "category": "odour",
            "domain": "sewer",
            "address": "456 Oak Ave",
            "description": "Bad smell",
        },
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["service_request"]["location"] is None
    assert body["duplicates"] == []


def test_dispatch_carries_sr_priority_when_unspecified(admin_client):
    create = admin_client.post(
        "/api/v1/service-requests",
        json=_intake_payload(priority="emergency"),
    )
    sr_number = create.get_json()["service_request"]["sr_number"]
    resp = admin_client.post(
        f"/api/v1/service-requests/{sr_number}/dispatch",
        json={"work_order": {"title": "Urgent"}},
    )
    body = resp.get_json()
    wo = admin_client.get(f"/api/v1/work-orders/{body['work_order_number']}").get_json()
    assert wo["priority"] == "emergency"


def test_sr_number_collision_retry_succeeds(admin_client, tenant):
    year = datetime.now(UTC).year
    occupied = f"SR-{year}-00001"
    _insert_sr(tenant, sr_number=occupied)
    resp = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    assert resp.status_code == 201
    assigned = resp.get_json()["service_request"]["sr_number"]
    assert assigned != occupied


def test_dispatched_sr_links_back_to_wo(admin_client):
    create = admin_client.post("/api/v1/service-requests", json=_intake_payload())
    sr_number = create.get_json()["service_request"]["sr_number"]
    dispatch = admin_client.post(
        f"/api/v1/service-requests/{sr_number}/dispatch",
        json={"work_order": {"title": "Investigate"}},
    )
    wo_number = dispatch.get_json()["work_order_number"]
    g.skip_tenant_filter = True
    wo = db.session.scalar(db.select(WorkOrder).where(WorkOrder.wo_number == wo_number))
    assert wo is not None
    assert wo.service_request_id is not None
