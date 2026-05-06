from __future__ import annotations

from flask import g

from app.extensions import db
from app.models import TaskDefinition
from app.seeds.tasks.wat_discoloured import TASK_WAT_DISCOLOURED
from app.services.tasks.complete import apply_auto_marks, is_complete
from app.services.tasks.match import find_matching_task
from app.services.tasks.prefill import build_prefill_data


def _seed_discoloured(tenant) -> TaskDefinition:
    g.skip_tenant_filter = True
    td = TaskDefinition(tenant_id=tenant.id, **TASK_WAT_DISCOLOURED)
    db.session.add(td)
    db.session.commit()
    return td


# ---------- match service ----------


def test_match_by_service_request_category(app, tenant):
    with app.app_context():
        _seed_discoloured(tenant)
        g.skip_tenant_filter = True
        td = find_matching_task(
            tenant_id=tenant.id,
            source="service_request",
            payload={"category": "discoloured_water", "domain": "water"},
        )
        assert td is not None
        assert td.code == "WAT-TASK-DISCOLOURED"


def test_match_returns_none_when_no_trigger_matches(app, tenant):
    with app.app_context():
        _seed_discoloured(tenant)
        g.skip_tenant_filter = True
        td = find_matching_task(
            tenant_id=tenant.id,
            source="service_request",
            payload={"category": "low_pressure"},
        )
        assert td is None


def test_match_skips_inactive(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        td.status = "draft"
        db.session.commit()
        g.skip_tenant_filter = True
        result = find_matching_task(
            tenant_id=tenant.id,
            source="service_request",
            payload={"category": "discoloured_water"},
        )
        assert result is None


# ---------- prefill service ----------


def test_prefill_pulls_from_service_request(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        from datetime import UTC, datetime

        from app.models import ServiceRequest

        sr = ServiceRequest(
            tenant_id=tenant.id,
            sr_number="SR-TEST-1",
            category="other",
            domain="water",
            priority="normal",
            status="new",
            reported_at=datetime.now(UTC),
            caller_name="Jane Doe",
            caller_phone="555-1212",
            reported_address="123 Main",
            description="Brown water from kitchen tap",
        )
        db.session.add(sr)
        db.session.commit()

        out = build_prefill_data(task=td, sources={"service_request": sr})
        assert out["caller_name"] == "Jane Doe"
        assert out["caller_phone"] == "555-1212"
        assert out["reported_address"] == "123 Main"
        assert out["description"].startswith("Brown")


def test_prefill_doesnt_overwrite_sr_with_asset_data(app, tenant):
    """SR-sourced address should not be replaced by asset's address_cached."""
    with app.app_context():
        td = _seed_discoloured(tenant)
        from datetime import UTC, datetime

        from app.models import Asset, ServiceRequest
        from app.services.geometry import geojson_to_wkb

        # Asset prefill block uses `address_cached`, but SR's
        # reported_address takes precedence on overlap (different keys
        # here, but the test confirms `setdefault` semantics).
        asset = Asset(
            tenant_id=tenant.id,
            asset_uid="HYD-PRE-1",
            class_code="WAT_HYD",
            geom=geojson_to_wkb({"type": "Point", "coordinates": [-76.5, 39.3]}),
            address_cached="789 Asset Lane",
        )
        sr = ServiceRequest(
            tenant_id=tenant.id,
            sr_number="SR-TEST-2",
            category="other",
            domain="water",
            priority="normal",
            status="new",
            reported_at=datetime.now(UTC),
            reported_address="123 Caller St",
        )
        db.session.add_all([asset, sr])
        db.session.commit()

        out = build_prefill_data(task=td, sources={"service_request": sr, "asset": asset})
        # Different keys, both present
        assert out["reported_address"] == "123 Caller St"
        assert out["address_cached"] == "789 Asset Lane"


# ---------- completion ----------


def test_is_complete_passes_with_full_answers(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        passed, unmet = is_complete(
            td,
            {"site_visited": True, "outcome": "resolved_on_site"},
        )
        assert passed
        assert unmet == []


def test_is_complete_fails_missing_required(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        passed, unmet = is_complete(td, {"site_visited": True})
        assert not passed
        assert "outcome" in unmet


def test_is_complete_fails_when_expression_false(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        passed, _unmet = is_complete(
            td,
            # Required fields populated but expression demands site_visited == true
            {"site_visited": False, "outcome": "resolved_on_site"},
        )
        assert not passed


def test_apply_auto_marks_sets_customer_notified(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        out = apply_auto_marks(td, {"site_visited": True, "outcome": "resolved_on_site"})
        assert out["customer_notified"] is True


def test_apply_auto_marks_skips_when_not_applicable(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        out = apply_auto_marks(td, {"site_visited": True, "outcome": "follow_up_needed"})
        assert "customer_notified" not in out


# ---------- spawn ----------


def test_spawn_creates_followup_when_target_missing(app, tenant):
    """The two referenced spawn targets aren't seeded; spawn should
    create a generic WO with task_definition_id=None and not crash."""
    with app.app_context():
        td = _seed_discoloured(tenant)
        from app.models import WorkOrder
        from app.services.tasks.spawn import evaluate_spawns

        # Build a parent WO with the task_definition_id pointing at td.
        from app.services.wo_number import next_wo_number

        wo = WorkOrder(
            tenant_id=tenant.id,
            wo_number=next_wo_number(tenant_id=tenant.id),
            type="reactive",
            category="inspection",
            priority="normal",
            status="open",
            title="Parent WO",
            task_definition_id=td.id,
        )
        db.session.add(wo)
        db.session.commit()

        # outcome=follow_up_needed → second spawn rule fires; target task
        # WAT-TASK-FOLLOWUP doesn't exist → graceful generic WO.
        spawned = evaluate_spawns(
            task=td,
            parent_entity=wo,
            task_data={"outcome": "follow_up_needed"},
        )
        assert len(spawned) == 1
        assert isinstance(spawned[0], WorkOrder)
        assert spawned[0].task_definition_id is None  # graceful fallback
        assert spawned[0].tenant_id == tenant.id


def test_spawn_does_not_fire_when_when_is_false(app, tenant):
    with app.app_context():
        td = _seed_discoloured(tenant)
        from app.models import WorkOrder
        from app.services.tasks.spawn import evaluate_spawns
        from app.services.wo_number import next_wo_number

        wo = WorkOrder(
            tenant_id=tenant.id,
            wo_number=next_wo_number(tenant_id=tenant.id),
            type="reactive",
            category="inspection",
            priority="normal",
            status="open",
            title="Parent WO",
            task_definition_id=td.id,
        )
        db.session.add(wo)
        db.session.commit()

        spawned = evaluate_spawns(
            task=td,
            parent_entity=wo,
            task_data={"outcome": "resolved_on_site"},
        )
        assert spawned == []


# ---------- API ----------


def test_api_list_active_only(admin_client, tenant):
    g.skip_tenant_filter = True
    _seed_discoloured(tenant)
    resp = admin_client.get("/api/v1/task-definitions?status=active")
    body = resp.get_json()
    codes = [item["code"] for item in body["items"]]
    assert "WAT-TASK-DISCOLOURED" in codes


def test_api_get_by_code(admin_client, tenant):
    g.skip_tenant_filter = True
    _seed_discoloured(tenant)
    resp = admin_client.get("/api/v1/task-definitions/WAT-TASK-DISCOLOURED")
    body = resp.get_json()
    assert resp.status_code == 200
    assert body["status"] == "active"
    assert body["form"][0]["id"] == "site_visited"


def test_api_match_endpoint(admin_client, tenant):
    g.skip_tenant_filter = True
    _seed_discoloured(tenant)
    resp = admin_client.post(
        "/api/v1/task-definitions/WAT-TASK-DISCOLOURED/match",
        json={"source": "service_request", "payload": {"category": "discoloured_water"}},
    )
    assert resp.status_code == 200
    assert resp.get_json()["code"] == "WAT-TASK-DISCOLOURED"


def test_api_match_no_match_404(admin_client, tenant):
    g.skip_tenant_filter = True
    _seed_discoloured(tenant)
    resp = admin_client.post(
        "/api/v1/task-definitions/WAT-TASK-DISCOLOURED/match",
        json={"source": "service_request", "payload": {"category": "no_water"}},
    )
    assert resp.status_code == 404


def test_api_validate_complete(admin_client, tenant):
    g.skip_tenant_filter = True
    _seed_discoloured(tenant)
    resp = admin_client.post(
        "/api/v1/task-definitions/WAT-TASK-DISCOLOURED/validate",
        json={
            "task_data": {"site_visited": True, "outcome": "resolved_on_site"},
            "entity_ctx": {},
        },
    )
    body = resp.get_json()
    assert body["is_complete"] is True
    assert body["unmet_requirements"] == []


def test_api_validate_unmet(admin_client, tenant):
    g.skip_tenant_filter = True
    _seed_discoloured(tenant)
    resp = admin_client.post(
        "/api/v1/task-definitions/WAT-TASK-DISCOLOURED/validate",
        json={"task_data": {}, "entity_ctx": {}},
    )
    body = resp.get_json()
    assert body["is_complete"] is False
    assert "site_visited" in body["unmet_requirements"]
    assert "outcome" in body["unmet_requirements"]


def test_api_validate_field_errors(admin_client, tenant):
    g.skip_tenant_filter = True
    _seed_discoloured(tenant)
    resp = admin_client.post(
        "/api/v1/task-definitions/WAT-TASK-DISCOLOURED/validate",
        json={
            "task_data": {"cold_run_minutes": 999, "outcome": "weird_value"},
        },
    )
    body = resp.get_json()
    assert body["is_valid"] is False
    assert "cold_run_minutes" in body["field_errors"]
    assert "outcome" in body["field_errors"]


def test_api_create_then_activate_flow(admin_client):
    g.skip_tenant_filter = True
    create_resp = admin_client.post(
        "/api/v1/task-definitions",
        json={
            "code": "TEST-VERSIONING",
            "title": "Versioning sanity",
            "produces": "work_order",
            "default_domain": "water",
            "applies_to_classes": [],
            "triggers": [],
            "form": [],
            "completion": {"required_fields": [], "expression": "true"},
        },
    )
    assert create_resp.status_code == 201
    draft = create_resp.get_json()
    assert draft["status"] == "draft"
    td_id = draft["id"]

    # Active fetch should 404 — no active version yet.
    miss = admin_client.get("/api/v1/task-definitions/TEST-VERSIONING")
    assert miss.status_code == 404

    activate = admin_client.post(f"/api/v1/task-definitions/{td_id}/activate")
    assert activate.status_code == 200
    assert activate.get_json()["status"] == "active"

    # Now active fetch returns it.
    fetch = admin_client.get("/api/v1/task-definitions/TEST-VERSIONING")
    assert fetch.status_code == 200


def test_api_cannot_edit_active(admin_client, tenant):
    g.skip_tenant_filter = True
    td = _seed_discoloured(tenant)
    resp = admin_client.patch(
        f"/api/v1/task-definitions/{td.id}",
        json={"title": "Changed!"},
    )
    assert resp.status_code == 409
    assert resp.get_json()["error"]["code"] == "active_immutable"


def test_api_new_version_then_activate_archives_old(admin_client, tenant):
    g.skip_tenant_filter = True
    td = _seed_discoloured(tenant)
    fork = admin_client.post("/api/v1/task-definitions/WAT-TASK-DISCOLOURED/new-version")
    assert fork.status_code == 201
    new_id = fork.get_json()["id"]

    activate = admin_client.post(f"/api/v1/task-definitions/{new_id}/activate")
    assert activate.status_code == 200
    assert activate.get_json()["version"] > td.version

    # Old version should be archived.
    g.skip_tenant_filter = True
    db.session.refresh(td)
    assert td.status == "archived"
