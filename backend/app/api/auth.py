from __future__ import annotations

import logging
from datetime import UTC, datetime

from flask import Blueprint, current_app, g, jsonify, request
from flask_login import current_user, login_required, login_user, logout_user
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select

from app.errors import AuthError, ConflictError, ValidationError
from app.extensions import csrf, db, limiter
from app.models import Role, Tenant, User, UserRole
from app.schemas.auth import (
    LoginRequest,
    PasswordChangeRequest,
    RegisterTenantRequest,
)
from app.schemas.tenant import TenantRead
from app.schemas.user import UserRead
from app.services.audit import emit_event
from app.services.auth import hash_password, needs_rehash, verify_password
from app.utils.uids import generate_user_uid

log = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")

DEFAULT_ROLES: list[tuple[str, str]] = [
    ("admin", "Administrator"),
    ("supervisor", "Supervisor"),
    ("tech", "Field tech"),
    ("readonly", "Read only"),
    ("intake", "Service intake"),
]


def _validate(model_cls, data):
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _user_payload(user: User) -> dict:
    return UserRead.model_validate(user).model_dump(mode="json")


def _tenant_payload(tenant: Tenant) -> dict:
    return TenantRead.model_validate(tenant).model_dump(mode="json")


def _register_limit() -> str:
    return current_app.config["SETTINGS"].rate_limit_register


def _login_limit() -> str:
    return current_app.config["SETTINGS"].rate_limit_login


@auth_bp.post("/register-tenant")
@csrf.exempt
@limiter.limit(_register_limit)
def register_tenant():
    data = _validate(RegisterTenantRequest, request.get_json(silent=True) or {})

    g.skip_tenant_filter = True

    existing = db.session.scalar(select(Tenant).where(Tenant.slug == data.slug))
    if existing:
        raise ConflictError("tenant slug already in use", code="slug_taken")

    tenant = Tenant(name=data.tenant_name, slug=data.slug, settings={})
    db.session.add(tenant)
    db.session.flush()

    roles = [Role(tenant_id=tenant.id, code=code, name=name) for code, name in DEFAULT_ROLES]
    db.session.add_all(roles)
    db.session.flush()

    admin_role = next(r for r in roles if r.code == "admin")

    user = User(
        tenant_id=tenant.id,
        user_uid=generate_user_uid(),
        email=data.admin_email.lower(),
        password_hash=hash_password(data.admin_password),
        full_name=data.full_name,
        phone=data.phone,
        is_active=True,
    )
    db.session.add(user)
    db.session.flush()

    db.session.add(UserRole(user_id=user.id, role_id=admin_role.id))

    emit_event(
        action="register_tenant",
        entity_type="Tenant",
        entity_id=str(tenant.id),
        tenant_id=tenant.id,
        user_id=user.id,
        after={
            "tenant_name": tenant.name,
            "slug": tenant.slug,
            "admin_email": user.email,
        },
    )

    db.session.commit()
    db.session.refresh(user)

    login_user(user)

    return (
        jsonify({"tenant": _tenant_payload(tenant), "user": _user_payload(user)}),
        201,
    )


@auth_bp.post("/login")
@csrf.exempt
@limiter.limit(_login_limit)
def login():
    data = _validate(LoginRequest, request.get_json(silent=True) or {})
    g.skip_tenant_filter = True

    tenant = db.session.scalar(select(Tenant).where(Tenant.slug == data.tenant_slug))
    if not tenant:
        emit_event(
            action="login_failed",
            entity_type="User",
            entity_id=data.email,
            after={"reason": "unknown_tenant"},
        )
        db.session.commit()
        raise AuthError("invalid credentials", code="bad_credentials")

    user = db.session.scalar(
        select(User).where(
            User.tenant_id == tenant.id,
            User.email == data.email.lower(),
            User.deleted_at.is_(None),
        )
    )

    if not user or not verify_password(user.password_hash, data.password):
        emit_event(
            action="login_failed",
            entity_type="User",
            entity_id=str(user.id) if user else data.email,
            tenant_id=tenant.id,
            user_id=user.id if user else None,
        )
        db.session.commit()
        raise AuthError("invalid credentials", code="bad_credentials")

    if not user.is_active:
        emit_event(
            action="login_failed",
            entity_type="User",
            entity_id=str(user.id),
            tenant_id=user.tenant_id,
            user_id=user.id,
            after={"reason": "inactive"},
        )
        db.session.commit()
        raise AuthError("account is inactive", code="inactive")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(data.password)

    user.last_login_at = datetime.now(UTC)

    emit_event(
        action="login",
        entity_type="User",
        entity_id=str(user.id),
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    db.session.commit()
    db.session.refresh(user)

    login_user(user)

    return jsonify({"user": _user_payload(user), "tenant": _tenant_payload(tenant)})


@auth_bp.post("/logout")
@login_required
def logout():
    user_id = current_user.id
    tenant_id = current_user.tenant_id
    emit_event(
        action="logout",
        entity_type="User",
        entity_id=str(user_id),
        tenant_id=tenant_id,
        user_id=user_id,
    )
    db.session.commit()
    logout_user()
    return "", 204


@auth_bp.get("/me")
@login_required
def me():
    user = current_user._get_current_object()
    tenant = db.session.get(Tenant, user.tenant_id)
    return jsonify({"user": _user_payload(user), "tenant": _tenant_payload(tenant)})


@auth_bp.post("/password/change")
@login_required
def change_password():
    data = _validate(PasswordChangeRequest, request.get_json(silent=True) or {})
    user = current_user._get_current_object()
    if not verify_password(user.password_hash, data.current):
        raise AuthError("current password is incorrect", code="bad_credentials")
    user.password_hash = hash_password(data.new)
    db.session.commit()
    return "", 204
