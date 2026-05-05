from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError

from app.errors import NotFoundError, ValidationError
from app.extensions import db
from app.models import Tenant
from app.schemas.tenant import TenantRead, TenantUpdate
from app.services.permissions import require_roles

tenant_bp = Blueprint("tenant", __name__, url_prefix="/api/v1/tenant")


def _tenant_payload(t: Tenant) -> dict:
    return TenantRead.model_validate(t).model_dump(mode="json")


def _get_current_tenant() -> Tenant:
    tenant = db.session.get(Tenant, current_user.tenant_id)
    if not tenant:
        raise NotFoundError("tenant not found")
    return tenant


@tenant_bp.get("")
@login_required
def get_tenant():
    return jsonify(_tenant_payload(_get_current_tenant()))


@tenant_bp.patch("")
@login_required
@require_roles("admin")
def update_tenant():
    try:
        data = TenantUpdate.model_validate(request.get_json(silent=True) or {})
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e

    tenant = _get_current_tenant()
    if data.name is not None:
        tenant.name = data.name
    if data.settings is not None:
        tenant.settings = data.settings

    db.session.commit()
    return jsonify(_tenant_payload(tenant))
