"""Cross-entity link endpoints.

A link rows are polymorphic — they tie pairs of (work_order, inspection,
service_request) together. The API verifies that the referenced rows exist
*in the caller's tenant* before creating the link, since the DB has no FK
to the underlying tables.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import or_, select

from app.api import validate_request as _validate
from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import db
from app.models import EntityLink, Inspection, ServiceRequest, WorkOrder
from app.schemas.links import LinkCreate, LinkListResponse, LinkRead
from app.services.audit import emit_event

links_bp = Blueprint("links", __name__, url_prefix="/api/v1/links")


def _verify_entity(kind: str, entity_id: int) -> str:
    """Return the human-readable reference (wo_number / SR-... / INS-...) so
    the link can render without a join. Raises if the row doesn't exist or
    is in another tenant.

    NB: we use `select(...).where(id == ...)` rather than `db.session.get()`
    so the tenant-filter listener actually applies. `get` can short-circuit
    via the identity map and return a row that wouldn't survive a
    tenant-scoped query.
    """
    if kind == "work_order":
        wo = db.session.scalar(select(WorkOrder).where(WorkOrder.id == entity_id))
        if not wo:
            raise NotFoundError(f"work_order {entity_id} not found", code="unknown_target")
        return wo.wo_number
    if kind == "inspection":
        ins = db.session.scalar(select(Inspection).where(Inspection.id == entity_id))
        if not ins:
            raise NotFoundError(f"inspection {entity_id} not found", code="unknown_target")
        return ins.inspection_number
    if kind == "service_request":
        sr = db.session.scalar(select(ServiceRequest).where(ServiceRequest.id == entity_id))
        if not sr:
            raise NotFoundError(f"service_request {entity_id} not found", code="unknown_target")
        return sr.sr_number
    raise ValidationError(f"unknown entity type {kind!r}", code="bad_type")


def _ref_for(kind: str, entity_id: int) -> str | None:
    """Like _verify_entity but None-tolerant — used during list serialization
    so a deleted target doesn't 404 the whole call."""
    try:
        return _verify_entity(kind, entity_id)
    except NotFoundError:
        return None


def _payload(link: EntityLink) -> dict[str, Any]:
    return {
        "id": link.id,
        "source_type": link.source_type,
        "source_id": link.source_id,
        "target_type": link.target_type,
        "target_id": link.target_id,
        "kind": link.kind,
        "note": link.note,
        "created_by": link.created_by,
        "created_at": link.created_at.isoformat(),
        "source_ref": _ref_for(link.source_type, link.source_id),
        "target_ref": _ref_for(link.target_type, link.target_id),
    }


@links_bp.get("")
@login_required
def list_links():
    """List links touching `(entity_type, entity_id)` (matches either side)."""
    entity_type = request.args.get("entity_type")
    entity_id_raw = request.args.get("entity_id")
    if not entity_type or not entity_id_raw:
        raise ValidationError(
            "entity_type and entity_id are required",
            code="missing_filters",
        )
    try:
        entity_id = int(entity_id_raw)
    except ValueError as e:
        raise ValidationError("entity_id must be an integer", code="bad_id") from e

    stmt = (
        select(EntityLink)
        .where(
            or_(
                (EntityLink.source_type == entity_type) & (EntityLink.source_id == entity_id),
                (EntityLink.target_type == entity_type) & (EntityLink.target_id == entity_id),
            )
        )
        .order_by(EntityLink.created_at.desc())
    )
    rows = db.session.scalars(stmt).all()
    return jsonify(LinkListResponse(items=[LinkRead.model_validate(_payload(r)) for r in rows]).model_dump(mode="json"))


@links_bp.post("")
@login_required
def create_link():
    data = _validate(LinkCreate, request.get_json(silent=True) or {})
    if data.source_type == data.target_type and data.source_id == data.target_id:
        raise ValidationError("cannot link an entity to itself", code="self_link")

    _verify_entity(data.source_type, data.source_id)
    _verify_entity(data.target_type, data.target_id)

    # Reject duplicate live links (same source + target + kind).
    existing = db.session.scalar(
        select(EntityLink).where(
            EntityLink.source_type == data.source_type,
            EntityLink.source_id == data.source_id,
            EntityLink.target_type == data.target_type,
            EntityLink.target_id == data.target_id,
            EntityLink.kind == data.kind,
            EntityLink.deleted_at.is_(None),
        )
    )
    if existing:
        raise ConflictError("link already exists", code="duplicate_link")

    link = EntityLink(
        tenant_id=current_user.tenant_id,
        source_type=data.source_type,
        source_id=data.source_id,
        target_type=data.target_type,
        target_id=data.target_id,
        kind=data.kind,
        note=data.note,
        created_by=current_user.id,
    )
    db.session.add(link)
    db.session.flush()

    emit_event(
        action="link_create",
        entity_type="EntityLink",
        entity_id=str(link.id),
        tenant_id=link.tenant_id,
        after={
            "source": f"{data.source_type}:{data.source_id}",
            "target": f"{data.target_type}:{data.target_id}",
            "kind": data.kind,
        },
    )
    db.session.commit()
    db.session.refresh(link)
    return jsonify(_payload(link)), 201


@links_bp.delete("/<int:link_id>")
@login_required
def delete_link(link_id: int):
    # select() routes through the tenant-filter listener; db.session.get()
    # would hit the identity map directly and bypass it.
    link = db.session.scalar(select(EntityLink).where(EntityLink.id == link_id))
    if not link:
        raise NotFoundError(f"link {link_id} not found")
    if link.deleted_at is not None:
        return "", 204
    link.deleted_at = datetime.now(UTC)
    emit_event(
        action="link_delete",
        entity_type="EntityLink",
        entity_id=str(link.id),
        tenant_id=link.tenant_id,
        before={
            "source": f"{link.source_type}:{link.source_id}",
            "target": f"{link.target_type}:{link.target_id}",
            "kind": link.kind,
        },
    )
    db.session.commit()
    return "", 204
