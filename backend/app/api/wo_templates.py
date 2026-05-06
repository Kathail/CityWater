from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select

from app.errors import ConflictError, ValidationError
from app.extensions import db
from app.models import WoTemplate
from app.schemas.work_order import WoTemplateCreate, WoTemplateRead
from app.services.permissions import require_roles

wo_templates_bp = Blueprint("wo_templates", __name__, url_prefix="/api/v1/wo-templates")


def _payload(t: WoTemplate) -> dict:
    return WoTemplateRead.model_validate(t).model_dump(mode="json")


@wo_templates_bp.get("")
@login_required
def list_templates():
    items = db.session.scalars(select(WoTemplate).order_by(WoTemplate.name)).all()
    return jsonify([_payload(t) for t in items])


@wo_templates_bp.post("")
@login_required
@require_roles("admin")
def create_template():
    try:
        data = WoTemplateCreate.model_validate(request.get_json(silent=True) or {})
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e

    existing = db.session.scalar(select(WoTemplate).where(WoTemplate.name == data.name))
    if existing:
        raise ConflictError(f"template {data.name!r} already exists", code="template_name_taken")

    template = WoTemplate(
        tenant_id=current_user.tenant_id,
        name=data.name,
        category=data.category,
        default_priority=data.default_priority,
        applies_to_classes=data.applies_to_classes,
        task_template=data.task_template,
        instructions=data.instructions,
    )
    db.session.add(template)
    db.session.commit()
    db.session.refresh(template)
    return jsonify(_payload(template)), 201
