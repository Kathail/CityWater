"""Task definition CRUD + match + validate.

Active versioning rules:
- Only one row per (tenant_id, code) may have status='active' (enforced
  by partial unique index `ux_task_def_one_active_per_code`).
- Drafts are editable. Active rows are NOT — operators must
  `POST /:code/new-version` to fork a new draft, then `POST /:id/activate`
  to flip it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api import validate_request as _validate
from app.errors import ConflictError, NotFoundError
from app.extensions import db
from app.models import TaskDefinition
from app.schemas.task_definition import (
    MatchRequest,
    TaskDefinitionBrief,
    TaskDefinitionCreate,
    TaskDefinitionListResponse,
    TaskDefinitionRead,
    TaskDefinitionUpdate,
    ValidateRequest,
    ValidateResponse,
)
from app.services.audit import emit_event
from app.services.permissions import require_roles
from app.services.tasks.complete import is_complete
from app.services.tasks.match import find_matching_task

task_definitions_bp = Blueprint("task_definitions", __name__, url_prefix="/api/v1/task-definitions")


def _read_payload(td: TaskDefinition) -> dict[str, Any]:
    return TaskDefinitionRead.model_validate(td).model_dump(mode="json")


def _brief_payload(td: TaskDefinition) -> dict[str, Any]:
    return TaskDefinitionBrief.model_validate(td).model_dump(mode="json")


@task_definitions_bp.get("")
@login_required
def list_task_definitions():
    status = request.args.get("status")
    domain = request.args.get("domain")
    cls = request.args.get("class")
    q = (request.args.get("q") or "").strip()

    stmt = select(TaskDefinition).where(TaskDefinition.deleted_at.is_(None))
    if status:
        stmt = stmt.where(TaskDefinition.status == status)
    if domain:
        stmt = stmt.where(TaskDefinition.default_domain == domain)
    if cls:
        # PostgreSQL ARRAY membership: use the SA `any_` operator
        stmt = stmt.where(TaskDefinition.applies_to_classes.any(cls))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (TaskDefinition.code.ilike(like))
            | (TaskDefinition.title.ilike(like))
            | (TaskDefinition.summary.ilike(like))
        )
    stmt = stmt.order_by(TaskDefinition.code, TaskDefinition.version.desc())
    rows = db.session.scalars(stmt).all()
    return jsonify(
        TaskDefinitionListResponse(items=[TaskDefinitionBrief.model_validate(r) for r in rows]).model_dump(mode="json")
    )


@task_definitions_bp.get("/<string:code>")
@login_required
def get_task_definition(code: str):
    version = request.args.get("version", type=int)
    stmt = select(TaskDefinition).where(
        TaskDefinition.code == code,
        TaskDefinition.deleted_at.is_(None),
    )
    if version is not None:
        stmt = stmt.where(TaskDefinition.version == version)
    else:
        stmt = stmt.where(TaskDefinition.status == "active")
    td = db.session.scalar(stmt)
    if not td:
        raise NotFoundError(f"task definition {code!r} not found")
    return jsonify(_read_payload(td))


@task_definitions_bp.post("")
@login_required
@require_roles("admin")
def create_task_definition():
    data = _validate(TaskDefinitionCreate, request.get_json(silent=True) or {})

    # Next version for this code, scoped to the tenant.
    max_version = (
        db.session.scalar(
            select(func.coalesce(func.max(TaskDefinition.version), 0)).where(
                TaskDefinition.tenant_id == current_user.tenant_id,
                TaskDefinition.code == data.code,
            )
        )
        or 0
    )

    td = TaskDefinition(
        tenant_id=current_user.tenant_id,
        code=data.code,
        version=max_version + 1,
        status="draft",
        title=data.title,
        summary=data.summary,
        produces=data.produces,
        default_category=data.default_category,
        default_priority=data.default_priority,
        default_domain=data.default_domain,
        applies_to_classes=data.applies_to_classes,
        triggers=data.triggers,
        prefill=data.prefill,
        form=data.form,
        canned_comments=data.canned_comments,
        procedure=data.procedure,
        completion=data.completion,
        spawns=data.spawns,
        clocks=data.clocks,
    )
    db.session.add(td)
    try:
        db.session.flush()
    except IntegrityError as e:
        db.session.rollback()
        raise ConflictError(
            "could not create task definition (duplicate version?)",
            code="version_collision",
        ) from e

    emit_event(
        action="task_definition_create",
        entity_type="TaskDefinition",
        entity_id=str(td.id),
        tenant_id=td.tenant_id,
        after={"code": td.code, "version": td.version},
    )
    db.session.commit()
    db.session.refresh(td)
    return jsonify(_read_payload(td)), 201


@task_definitions_bp.patch("/<int:td_id>")
@login_required
@require_roles("admin")
def update_task_definition(td_id: int):
    td = db.session.scalar(select(TaskDefinition).where(TaskDefinition.id == td_id))
    if not td or td.deleted_at is not None:
        raise NotFoundError(f"task definition {td_id} not found")
    if td.status != "draft":
        raise ConflictError(
            "active versions cannot be edited; fork a new version first",
            code="active_immutable",
        )

    data = _validate(TaskDefinitionUpdate, request.get_json(silent=True) or {})
    for field in (
        "title",
        "summary",
        "default_category",
        "default_priority",
        "default_domain",
        "applies_to_classes",
        "triggers",
        "prefill",
        "form",
        "canned_comments",
        "procedure",
        "completion",
        "spawns",
        "clocks",
    ):
        v = getattr(data, field)
        if v is not None:
            setattr(td, field, v)

    db.session.commit()
    db.session.refresh(td)
    return jsonify(_read_payload(td))


@task_definitions_bp.post("/<string:code>/new-version")
@login_required
@require_roles("admin")
def fork_new_version(code: str):
    """Fork the active version into a new draft. Returns the new draft."""
    active = db.session.scalar(
        select(TaskDefinition).where(
            TaskDefinition.code == code,
            TaskDefinition.status == "active",
            TaskDefinition.deleted_at.is_(None),
        )
    )
    if not active:
        raise NotFoundError(f"no active version for code {code!r}")

    max_version = (
        db.session.scalar(
            select(func.coalesce(func.max(TaskDefinition.version), 0)).where(
                TaskDefinition.tenant_id == current_user.tenant_id,
                TaskDefinition.code == code,
            )
        )
        or 0
    )

    draft = TaskDefinition(
        tenant_id=current_user.tenant_id,
        code=active.code,
        version=max_version + 1,
        status="draft",
        title=active.title,
        summary=active.summary,
        produces=active.produces,
        default_category=active.default_category,
        default_priority=active.default_priority,
        default_domain=active.default_domain,
        applies_to_classes=list(active.applies_to_classes),
        triggers=list(active.triggers or []),
        prefill=dict(active.prefill or {}),
        form=list(active.form or []),
        canned_comments=list(active.canned_comments or []),
        procedure=dict(active.procedure or {}),
        completion=dict(active.completion or {}),
        spawns=list(active.spawns or []),
        clocks=list(active.clocks or []),
    )
    db.session.add(draft)
    db.session.commit()
    db.session.refresh(draft)
    return jsonify(_read_payload(draft)), 201


@task_definitions_bp.post("/<int:td_id>/activate")
@login_required
@require_roles("admin")
def activate_task_definition(td_id: int):
    td = db.session.scalar(select(TaskDefinition).where(TaskDefinition.id == td_id))
    if not td or td.deleted_at is not None:
        raise NotFoundError(f"task definition {td_id} not found")
    if td.status != "draft":
        raise ConflictError("only drafts can be activated", code="not_draft")

    # Archive the current active version, if any.
    prior = db.session.scalar(
        select(TaskDefinition).where(
            TaskDefinition.tenant_id == td.tenant_id,
            TaskDefinition.code == td.code,
            TaskDefinition.status == "active",
            TaskDefinition.deleted_at.is_(None),
        )
    )
    if prior and prior.id != td.id:
        prior.status = "archived"

    td.status = "active"
    emit_event(
        action="task_definition_activate",
        entity_type="TaskDefinition",
        entity_id=str(td.id),
        tenant_id=td.tenant_id,
        after={"code": td.code, "version": td.version},
        before=({"replaced_version": prior.version} if prior and prior.id != td.id else None),
    )
    db.session.commit()
    db.session.refresh(td)
    return jsonify(_read_payload(td))


@task_definitions_bp.delete("/<int:td_id>")
@login_required
@require_roles("admin")
def soft_delete_task_definition(td_id: int):
    td = db.session.scalar(select(TaskDefinition).where(TaskDefinition.id == td_id))
    if not td:
        raise NotFoundError(f"task definition {td_id} not found")
    if td.status == "active":
        raise ConflictError(
            "cannot delete an active version — archive or fork first",
            code="active_immutable",
        )
    td.deleted_at = datetime.now(UTC)
    db.session.commit()
    return "", 204


@task_definitions_bp.post("/<string:code>/match")
@login_required
def match_task_definition(code: str):
    """Match the supplied source/payload to a task. The `code` route arg
    is decorative for client-side caching — the actual match is by
    triggers, not by the URL code. Body shape is uniform."""
    _ = code  # unused; URL convention only
    data = _validate(MatchRequest, request.get_json(silent=True) or {})
    td = find_matching_task(
        tenant_id=current_user.tenant_id,
        source=data.source,
        payload=data.payload,
    )
    if not td:
        raise NotFoundError("no task definition matched", code="no_match")
    return jsonify(_read_payload(td))


@task_definitions_bp.post("/<string:code>/validate")
@login_required
def validate_task_data(code: str):
    td = db.session.scalar(
        select(TaskDefinition).where(
            TaskDefinition.code == code,
            TaskDefinition.status == "active",
            TaskDefinition.deleted_at.is_(None),
        )
    )
    if not td:
        raise NotFoundError(f"task definition {code!r} not found")
    data = _validate(ValidateRequest, request.get_json(silent=True) or {})

    field_errors = _per_field_errors(td, data.task_data)
    passed_complete, unmet = is_complete(td, data.task_data, data.entity_ctx)
    return jsonify(
        ValidateResponse(
            is_valid=len(field_errors) == 0,
            is_complete=passed_complete,
            field_errors=field_errors,
            unmet_requirements=unmet,
        ).model_dump(mode="json")
    )


def _per_field_errors(td: TaskDefinition, task_data: dict) -> dict[str, str]:
    """Cheap per-field validation against form descriptors. Heavy
    validation (asset existence, etc.) belongs in the entity-level
    creators."""
    errors: dict[str, str] = {}
    for field in td.form or []:
        fid = field.get("id")
        if not fid:
            continue
        value = task_data.get(fid)
        if value is None:
            continue
        ftype = field.get("type")
        if ftype == "number" and not isinstance(value, int | float):
            errors[fid] = "must be a number"
            continue
        if ftype == "number":
            mn = field.get("min")
            mx = field.get("max")
            if mn is not None and value < mn:
                errors[fid] = f"min {mn}"
            elif mx is not None and value > mx:
                errors[fid] = f"max {mx}"
        if ftype == "boolean" and not isinstance(value, bool):
            errors[fid] = "must be true/false"
        if ftype == "choice":
            allowed = [c.get("value") for c in field.get("choices") or []]
            if value not in allowed:
                errors[fid] = f"must be one of {allowed}"
        if ftype == "multi_choice":
            allowed = [c.get("value") for c in field.get("choices") or []]
            if not isinstance(value, list) or not all(v in allowed for v in value):
                errors[fid] = f"each value must be one of {allowed}"
    return errors
