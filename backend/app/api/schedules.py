from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api import validate_request as _validate
from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import db
from app.models import Asset, Schedule
from app.schemas.schedule import (
    ScheduleCreate,
    ScheduleListResponse,
    ScheduleRead,
    ScheduleTickResponse,
    ScheduleUpdate,
)
from app.services.audit import emit_event
from app.services.permissions import require_roles
from app.services.schedules import next_occurrence_after, parse_rrule, tick

schedules_bp = Blueprint("schedules", __name__, url_prefix="/api/v1/schedules")


def _resolve_asset(uid: str | None) -> int | None:
    if not uid:
        return None
    asset = db.session.scalar(select(Asset).where(Asset.asset_uid == uid))
    if not asset:
        raise ValidationError(f"asset {uid} not found", code="unknown_asset")
    return asset.id


def _payload(s: Schedule) -> dict[str, Any]:
    asset_uid = None
    if s.asset_id:
        a = db.session.get(Asset, s.asset_id)
        asset_uid = a.asset_uid if a else None
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "kind": s.kind,
        "rrule": s.rrule,
        "spec": s.spec or {},
        "asset_id": s.asset_id,
        "asset_uid": asset_uid,
        "next_run_at": s.next_run_at.isoformat() if s.next_run_at else None,
        "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
        "active": s.active,
        "created_by": s.created_by,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }


@schedules_bp.get("")
@login_required
def list_schedules():
    rows = db.session.scalars(select(Schedule).order_by(Schedule.next_run_at.asc().nulls_last(), Schedule.name)).all()
    return jsonify(
        ScheduleListResponse(items=[ScheduleRead.model_validate(_payload(r)) for r in rows]).model_dump(mode="json")
    )


@schedules_bp.post("")
@login_required
@require_roles("admin", "supervisor")
def create_schedule():
    data = _validate(ScheduleCreate, request.get_json(silent=True) or {})
    parse_rrule(data.rrule)  # validates

    asset_id = _resolve_asset(data.asset_uid)

    next_run = data.next_run_at
    if next_run is None:
        # First occurrence at-or-after "now". The rrule is anchored to the
        # request time so a daily schedule fires today (if no time-of-day
        # is in the rule) or at the rule's first occurrence after now.
        next_run = next_occurrence_after(data.rrule, datetime.now(UTC))

    s = Schedule(
        tenant_id=current_user.tenant_id,
        name=data.name,
        description=data.description,
        kind=data.kind,
        rrule=data.rrule,
        spec=data.spec,
        asset_id=asset_id,
        next_run_at=next_run,
        active=data.active,
        created_by=current_user.id,
    )
    db.session.add(s)
    try:
        db.session.flush()
    except IntegrityError as e:
        db.session.rollback()
        raise ConflictError(
            "a schedule with that name already exists",
            code="name_taken",
        ) from e

    emit_event(
        action="schedule_create",
        entity_type="Schedule",
        entity_id=str(s.id),
        tenant_id=s.tenant_id,
        after={"name": s.name, "kind": s.kind, "rrule": s.rrule},
    )
    db.session.commit()
    db.session.refresh(s)
    return jsonify(_payload(s)), 201


@schedules_bp.get("/<int:schedule_id>")
@login_required
def get_schedule(schedule_id: int):
    s = db.session.scalar(select(Schedule).where(Schedule.id == schedule_id))
    if not s:
        raise NotFoundError(f"schedule {schedule_id} not found")
    return jsonify(_payload(s))


@schedules_bp.patch("/<int:schedule_id>")
@login_required
@require_roles("admin", "supervisor")
def update_schedule(schedule_id: int):
    s = db.session.scalar(select(Schedule).where(Schedule.id == schedule_id))
    if not s:
        raise NotFoundError(f"schedule {schedule_id} not found")
    data = _validate(ScheduleUpdate, request.get_json(silent=True) or {})

    if data.rrule is not None:
        parse_rrule(data.rrule)
        s.rrule = data.rrule
    if data.name is not None:
        s.name = data.name
    if data.description is not None:
        s.description = data.description
    if data.spec is not None:
        s.spec = data.spec
    if data.next_run_at is not None:
        s.next_run_at = data.next_run_at
    if data.active is not None:
        s.active = data.active
    if data.asset_uid is not None:
        s.asset_id = _resolve_asset(data.asset_uid)

    db.session.commit()
    db.session.refresh(s)
    return jsonify(_payload(s))


@schedules_bp.delete("/<int:schedule_id>")
@login_required
@require_roles("admin", "supervisor")
def delete_schedule(schedule_id: int):
    s = db.session.scalar(select(Schedule).where(Schedule.id == schedule_id))
    if not s:
        raise NotFoundError(f"schedule {schedule_id} not found")
    s.deleted_at = datetime.now(UTC)
    s.active = False
    emit_event(
        action="schedule_delete",
        entity_type="Schedule",
        entity_id=str(s.id),
        tenant_id=s.tenant_id,
        before={"name": s.name},
    )
    db.session.commit()
    return "", 204


@schedules_bp.post("/tick")
@login_required
@require_roles("admin", "supervisor")
def tick_endpoint():
    """Manual fire of the cron tick — useful for testing schedules without
    waiting for the systemd timer."""
    summary = tick(datetime.now(UTC))
    emit_event(
        action="schedule_tick",
        entity_type="Schedule",
        entity_id="*",
        tenant_id=current_user.tenant_id,
        after=summary,
    )
    db.session.commit()
    return jsonify(ScheduleTickResponse(**summary).model_dump(mode="json"))
