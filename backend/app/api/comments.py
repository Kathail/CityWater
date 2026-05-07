"""Free-text comments attached to any (work_order | inspection |
service_request | schedule) row.

Edit/delete is restricted to the author or admin/supervisor — same model
used in most ops tools. Comments are tenant-scoped via the listener.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import select

from app.api import validate_request as _validate
from app.errors import ForbiddenError, NotFoundError, ValidationError
from app.extensions import db
from app.models import Comment, Inspection, Schedule, ServiceRequest, User, WorkOrder
from app.schemas.comment import (
    CommentCreate,
    CommentListResponse,
    CommentRead,
    CommentUpdate,
)
from app.services.audit import emit_event

comments_bp = Blueprint("comments", __name__, url_prefix="/api/v1/comments")


def _verify_entity(kind: str, entity_id: int) -> None:
    """Confirm the (kind, id) row exists in this tenant. Polymorphic — no FK."""
    table_for = {
        "work_order": WorkOrder,
        "inspection": Inspection,
        "service_request": ServiceRequest,
        "schedule": Schedule,
    }
    cls = table_for.get(kind)
    if cls is None:
        raise ValidationError(f"unknown entity_type {kind!r}", code="bad_type")
    row = db.session.scalar(select(cls).where(cls.id == entity_id))
    if not row:
        raise NotFoundError(f"{kind} {entity_id} not found", code="unknown_entity")


def _author_name(user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = db.session.scalar(select(User).where(User.id == user_id))
    return user.full_name if user else None


def _payload(c: Comment) -> dict[str, Any]:
    return {
        "id": c.id,
        "entity_type": c.entity_type,
        "entity_id": c.entity_id,
        "body": c.body,
        "created_by": c.created_by,
        "author_name": _author_name(c.created_by),
        "created_at": c.created_at.isoformat(),
        "edited_at": c.edited_at.isoformat() if c.edited_at else None,
    }


def _can_edit(comment: Comment) -> bool:
    if comment.created_by == current_user.id:
        return True
    user_roles = {r.code for r in current_user._get_current_object().roles}
    return bool(user_roles & {"admin", "supervisor"})


@comments_bp.get("")
@login_required
def list_comments():
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

    rows = db.session.scalars(
        select(Comment)
        .where(Comment.entity_type == entity_type, Comment.entity_id == entity_id)
        .order_by(Comment.created_at.asc())
    ).all()
    return jsonify(
        CommentListResponse(items=[CommentRead.model_validate(_payload(r)) for r in rows]).model_dump(mode="json")
    )


@comments_bp.post("")
@login_required
def create_comment():
    data = _validate(CommentCreate, request.get_json(silent=True) or {})
    _verify_entity(data.entity_type, data.entity_id)

    comment = Comment(
        tenant_id=current_user.tenant_id,
        entity_type=data.entity_type,
        entity_id=data.entity_id,
        body=data.body.strip(),
        created_by=current_user.id,
    )
    db.session.add(comment)
    db.session.flush()

    emit_event(
        action="comment_create",
        entity_type="Comment",
        entity_id=str(comment.id),
        tenant_id=comment.tenant_id,
        after={"target": f"{data.entity_type}:{data.entity_id}"},
    )
    db.session.commit()
    db.session.refresh(comment)
    return jsonify(_payload(comment)), 201


@comments_bp.patch("/<int:comment_id>")
@login_required
def update_comment(comment_id: int):
    # select() routes through the tenant-filter listener; db.session.get()
    # would hit the identity map directly and bypass it.
    comment = db.session.scalar(select(Comment).where(Comment.id == comment_id))
    if not comment or comment.deleted_at is not None:
        raise NotFoundError(f"comment {comment_id} not found")
    if not _can_edit(comment):
        raise ForbiddenError("only the author or an admin can edit this comment")

    data = _validate(CommentUpdate, request.get_json(silent=True) or {})
    comment.body = data.body.strip()
    comment.edited_at = datetime.now(UTC)
    db.session.commit()
    db.session.refresh(comment)
    return jsonify(_payload(comment))


@comments_bp.delete("/<int:comment_id>")
@login_required
def delete_comment(comment_id: int):
    comment = db.session.scalar(select(Comment).where(Comment.id == comment_id))
    if not comment:
        raise NotFoundError(f"comment {comment_id} not found")
    if comment.deleted_at is not None:
        return "", 204
    if not _can_edit(comment):
        raise ForbiddenError("only the author or an admin can delete this comment")

    comment.deleted_at = datetime.now(UTC)
    emit_event(
        action="comment_delete",
        entity_type="Comment",
        entity_id=str(comment.id),
        tenant_id=comment.tenant_id,
    )
    db.session.commit()
    return "", 204
