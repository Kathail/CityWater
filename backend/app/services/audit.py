from __future__ import annotations

from typing import Any

from flask import g, has_request_context, request
from flask_login import current_user
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.extensions import db
from app.models.audit import AuditLog
from app.models.mixins import AuditableMixin

_PENDING_KEY = "_pending_audit_entries"
_NEVER_AUDIT_FIELDS: set[str] = {"password_hash"}


def _serialize(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    # PostGIS geometries → GeoJSON
    try:
        from geoalchemy2 import WKBElement
        from geoalchemy2.shape import to_shape

        if isinstance(value, WKBElement):
            return to_shape(value).__geo_interface__
    except ImportError:
        pass
    # Numeric → string (lossless)
    from decimal import Decimal

    if isinstance(value, Decimal):
        return str(value)
    return value


def _state_dict(obj: Any) -> dict[str, Any]:
    inspector = inspect(obj)
    return {
        attr.key: _serialize(getattr(obj, attr.key))
        for attr in inspector.mapper.column_attrs
        if attr.key not in _NEVER_AUDIT_FIELDS
    }


def _diff(obj: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    inspector = inspect(obj)
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for attr in inspector.mapper.column_attrs:
        if attr.key in _NEVER_AUDIT_FIELDS:
            continue
        history = inspector.attrs[attr.key].history
        if history.has_changes():
            old = history.deleted[0] if history.deleted else None
            new = history.added[0] if history.added else None
            before[attr.key] = _serialize(old)
            after[attr.key] = _serialize(new)
    return before, after


def _request_meta() -> tuple[str | None, str | None]:
    if not has_request_context():
        return None, None
    ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if ip and "," in ip:
        ip = ip.split(",")[0].strip()
    ua = request.headers.get("User-Agent")
    return ip, ua


def _current_user_id() -> int | None:
    if not has_request_context():
        return None
    if current_user and current_user.is_authenticated:
        return current_user.id
    return getattr(g, "audit_user_id", None)


@event.listens_for(Session, "before_flush")
def _capture_pending(session: Session, _flush_context, _instances) -> None:
    pending: list[dict[str, Any]] = session.info.setdefault(_PENDING_KEY, [])
    user_id = _current_user_id()
    ip, ua = _request_meta()

    for obj in list(session.new):
        if isinstance(obj, AuditableMixin):
            pending.append(
                {
                    "obj": obj,
                    "action": "create",
                    "before": None,
                    "after": _state_dict(obj),
                    "user_id": user_id,
                    "ip": ip,
                    "user_agent": ua,
                }
            )

    for obj in list(session.dirty):
        if not isinstance(obj, AuditableMixin):
            continue
        if not session.is_modified(obj, include_collections=False):
            continue
        before, after = _diff(obj)
        if not before and not after:
            continue
        pending.append(
            {
                "obj": obj,
                "action": "update",
                "before": before,
                "after": after,
                "user_id": user_id,
                "ip": ip,
                "user_agent": ua,
            }
        )

    for obj in list(session.deleted):
        if isinstance(obj, AuditableMixin):
            pending.append(
                {
                    "obj": obj,
                    "action": "delete",
                    "before": _state_dict(obj),
                    "after": None,
                    "user_id": user_id,
                    "ip": ip,
                    "user_agent": ua,
                }
            )


@event.listens_for(Session, "after_flush_postexec")
def _emit_pending(session: Session, _flush_context) -> None:
    pending: list[dict[str, Any]] = session.info.pop(_PENDING_KEY, [])
    if not pending:
        return
    new_entries: list[AuditLog] = []
    for entry in pending:
        obj = entry["obj"]
        new_entries.append(
            AuditLog(
                tenant_id=getattr(obj, "tenant_id", None),
                user_id=entry["user_id"],
                entity_type=type(obj).__name__,
                entity_id=str(getattr(obj, "id", "") or ""),
                action=entry["action"],
                before=entry["before"],
                after=entry["after"],
                ip=entry["ip"],
                user_agent=entry["user_agent"],
            )
        )
    session.add_all(new_entries)


def emit_event(
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    tenant_id: int | None = None,
    user_id: int | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """Emit a non-mutation audit event (login, logout, failed_login, register_tenant)."""
    ip, ua = _request_meta()
    if user_id is None:
        user_id = _current_user_id()
    db.session.add(
        AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            before=before,
            after=after,
            ip=ip,
            user_agent=ua,
        )
    )
