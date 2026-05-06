"""Read-only audit-history view scoped to a single entity.

Returns the audit_log rows tied to a target row (e.g. all events on
WO-2026-00042) so the frontend can render a chronological timeline. The
endpoint mirrors the entity_type strings the comments + links endpoints
use for consistency, but maps them to the audit_log's entity_type values
which are the model class names ("WorkOrder", "Inspection", ...).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import or_, select

from app.errors import ValidationError
from app.extensions import db
from app.models import AuditLog, User

history_bp = Blueprint("history", __name__, url_prefix="/api/v1/history")

# Map the public polymorphic enum to the audit_log entity_type values.
ENTITY_MAP = {
    "work_order": ["WorkOrder"],
    "inspection": ["Inspection"],
    "service_request": ["ServiceRequest"],
    "schedule": ["Schedule"],
}


@history_bp.get("")
@login_required
def list_history() -> Any:
    entity_type = request.args.get("entity_type")
    entity_id_raw = request.args.get("entity_id")
    if not entity_type or not entity_id_raw:
        raise ValidationError(
            "entity_type and entity_id are required",
            code="missing_filters",
        )
    if entity_type not in ENTITY_MAP:
        raise ValidationError(f"unknown entity_type {entity_type!r}", code="bad_type")
    try:
        entity_id = int(entity_id_raw)
    except ValueError as e:
        raise ValidationError("entity_id must be an integer", code="bad_id") from e

    audit_types = ENTITY_MAP[entity_type]

    # Audit rows store `entity_id` as TEXT, so compare as string. We *also*
    # surface link/comment events that reference this entity in their
    # before/after payload — handy for "who linked X to Y" history lines.
    related_target = f"{entity_type}:{entity_id}"
    stmt = (
        select(AuditLog)
        .where(
            or_(
                (AuditLog.entity_type.in_(audit_types))
                & (AuditLog.entity_id == str(entity_id)),
                (AuditLog.entity_type == "EntityLink")
                & (
                    (AuditLog.before["source"].astext == related_target)
                    | (AuditLog.before["target"].astext == related_target)
                    | (AuditLog.after["source"].astext == related_target)
                    | (AuditLog.after["target"].astext == related_target)
                ),
                (AuditLog.entity_type == "Comment")
                & (AuditLog.after["target"].astext == related_target),
            )
        )
        .order_by(AuditLog.occurred_at.desc())
        .limit(200)
    )
    rows = db.session.scalars(stmt).all()

    user_ids = {r.user_id for r in rows if r.user_id is not None}
    user_names: dict[int, str] = {}
    if user_ids:
        users = db.session.scalars(
            select(User).where(User.id.in_(user_ids))
        ).all()
        user_names = {u.id: u.full_name for u in users}

    items = [
        {
            "id": r.id,
            "occurred_at": (
                r.occurred_at.isoformat()
                if isinstance(r.occurred_at, datetime)
                else r.occurred_at
            ),
            "actor": user_names.get(r.user_id) if r.user_id else None,
            "actor_id": r.user_id,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "before": r.before,
            "after": r.after,
        }
        for r in rows
    ]
    _ = current_user  # auth-only; nothing to filter further today
    return jsonify({"items": items})
