from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select

from app.errors import ValidationError
from app.extensions import db
from app.models import Crew
from app.schemas.work_order import CrewCreate, CrewRead
from app.services.permissions import require_roles

crews_bp = Blueprint("crews", __name__, url_prefix="/api/v1/crews")


def _payload(c: Crew) -> dict:
    return CrewRead.model_validate(c).model_dump(mode="json")


@crews_bp.get("")
@login_required
def list_crews():
    items = db.session.scalars(
        select(Crew).where(Crew.is_active.is_(True)).order_by(Crew.name)
    ).all()
    return jsonify([_payload(c) for c in items])


@crews_bp.post("")
@login_required
@require_roles("admin", "supervisor")
def create_crew():
    try:
        data = CrewCreate.model_validate(request.get_json(silent=True) or {})
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e

    crew = Crew(
        tenant_id=current_user.tenant_id,
        name=data.name,
        lead_user_id=data.lead_user_id,
        is_active=True,
    )
    db.session.add(crew)
    db.session.commit()
    db.session.refresh(crew)
    return jsonify(_payload(crew)), 201
