from __future__ import annotations

from datetime import UTC, datetime, timedelta

from flask import g

from app.extensions import db
from app.models import Inspection, Schedule, WorkOrder
from app.services.schedules import next_occurrence_after, parse_rrule, tick


def test_create_schedule_for_wo(admin_client):
    resp = admin_client.post(
        "/api/v1/schedules",
        json={
            "name": "Quarterly hydrant flushing",
            "kind": "work_order",
            "rrule": "FREQ=MONTHLY;INTERVAL=3",
            "spec": {
                "category": "flushing",
                "priority": "normal",
                "title": "Hydrant flushing — N grid",
            },
        },
    )
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert body["next_run_at"] is not None
    assert body["active"] is True


def test_create_schedule_validates_rrule(admin_client):
    resp = admin_client.post(
        "/api/v1/schedules",
        json={
            "name": "Bad rrule",
            "kind": "inspection",
            "rrule": "this is not a real rrule",
            "spec": {"kind": "manhole"},
        },
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "bad_rrule"


def test_tech_cannot_create(tech_client):
    resp = tech_client.post(
        "/api/v1/schedules",
        json={
            "name": "x",
            "kind": "work_order",
            "rrule": "FREQ=DAILY",
            "spec": {},
        },
    )
    assert resp.status_code == 403


def test_tick_fires_due_schedules(admin_client, tenant, app):
    g.skip_tenant_filter = True
    schedule = Schedule(
        tenant_id=tenant.id,
        name="Daily hydrant check",
        kind="work_order",
        rrule="FREQ=DAILY",
        spec={"category": "flushing", "priority": "low"},
        next_run_at=datetime.now(UTC) - timedelta(minutes=1),
        active=True,
    )
    db.session.add(schedule)
    db.session.commit()

    with app.app_context():
        g.skip_tenant_filter = True
        summary = tick(datetime.now(UTC))

    assert summary["fired"] == 1
    assert summary["schedules_processed"] >= 1
    assert summary["instances"]
    # WO should exist and be linked back to the schedule.
    g.skip_tenant_filter = True
    wo = db.session.scalar(db.select(WorkOrder).where(WorkOrder.wo_number == summary["instances"][0]))
    assert wo is not None
    assert wo.schedule_id == schedule.id

    # next_run_at should advance to a future time.
    db.session.refresh(schedule)
    assert schedule.last_run_at is not None
    assert schedule.next_run_at is not None
    assert schedule.next_run_at > datetime.now(UTC) - timedelta(minutes=1)


def test_tick_fires_inspection_schedule(admin_client, tenant, app):
    g.skip_tenant_filter = True
    schedule = Schedule(
        tenant_id=tenant.id,
        name="Weekly MH inspection",
        kind="inspection",
        rrule="FREQ=WEEKLY",
        spec={"kind": "manhole"},
        next_run_at=datetime.now(UTC) - timedelta(seconds=10),
        active=True,
    )
    db.session.add(schedule)
    db.session.commit()

    with app.app_context():
        g.skip_tenant_filter = True
        summary = tick(datetime.now(UTC))

    assert summary["fired"] >= 1
    g.skip_tenant_filter = True
    ins = db.session.scalar(db.select(Inspection).where(Inspection.schedule_id == schedule.id))
    assert ins is not None
    assert ins.kind == "manhole"


def test_tick_skips_inactive(admin_client, tenant, app):
    g.skip_tenant_filter = True
    schedule = Schedule(
        tenant_id=tenant.id,
        name="Paused schedule",
        kind="work_order",
        rrule="FREQ=DAILY",
        spec={"category": "other"},
        next_run_at=datetime.now(UTC) - timedelta(days=1),
        active=False,
    )
    db.session.add(schedule)
    db.session.commit()

    with app.app_context():
        g.skip_tenant_filter = True
        summary = tick(datetime.now(UTC))
    # Other tests in the same DB session may have left active schedules;
    # what matters is *this* one didn't fire.
    db.session.refresh(schedule)
    assert schedule.last_run_at is None
    _ = summary  # not strictly relevant


def test_tick_endpoint_supervisor_can_call(supervisor_client):
    resp = supervisor_client.post("/api/v1/schedules/tick")
    assert resp.status_code == 200


def test_tick_endpoint_tech_forbidden(tech_client):
    # Split from the supervisor case so we don't trip the pytest-flask
    # `current_user` leak between two test_clients in one test (see
    # project_pytest_flask_current_user_quirk memory).
    resp = tech_client.post("/api/v1/schedules/tick")
    assert resp.status_code == 403


def test_next_occurrence_after_advances():
    base = datetime(2026, 5, 6, 12, 0, 0, tzinfo=UTC)
    nxt = next_occurrence_after("FREQ=DAILY", base)
    assert nxt == datetime(2026, 5, 7, 12, 0, 0, tzinfo=UTC)


def test_parse_rrule_rejects_garbage():
    from app.errors import ValidationError

    try:
        parse_rrule("not actually a rule")
    except ValidationError as e:
        assert e.code == "bad_rrule"
    else:
        raise AssertionError("expected ValidationError")


def test_update_schedule_rrule(admin_client):
    create = admin_client.post(
        "/api/v1/schedules",
        json={
            "name": "Edit me",
            "kind": "work_order",
            "rrule": "FREQ=DAILY",
            "spec": {"category": "other"},
        },
    )
    sid = create.get_json()["id"]
    resp = admin_client.patch(
        f"/api/v1/schedules/{sid}",
        json={"rrule": "FREQ=WEEKLY;BYDAY=MO"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["rrule"] == "FREQ=WEEKLY;BYDAY=MO"


def test_delete_schedule_soft_deletes_and_404s_on_get(admin_client):
    create = admin_client.post(
        "/api/v1/schedules",
        json={
            "name": "Delete me",
            "kind": "work_order",
            "rrule": "FREQ=DAILY",
            "spec": {},
        },
    )
    sid = create.get_json()["id"]
    resp = admin_client.delete(f"/api/v1/schedules/{sid}")
    assert resp.status_code == 204
    # Soft-deleted rows are filtered out by the listener — GET 404s, list
    # excludes the row. Operators wanting recovery can pull from the audit
    # log + an admin SQL hand-restore.
    follow = admin_client.get(f"/api/v1/schedules/{sid}")
    assert follow.status_code == 404
