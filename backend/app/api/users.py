from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import db
from app.models import Role, User, UserRole
from app.schemas.user import (
    UserCreate,
    UserListResponse,
    UserRead,
    UserRolesUpdate,
    UserUpdate,
)
from app.services.auth import hash_password
from app.services.permissions import require_roles
from app.utils.uids import generate_user_uid

users_bp = Blueprint("users", __name__, url_prefix="/api/v1/users")


def _validate(model_cls, data):
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _user_payload(user: User) -> dict:
    return UserRead.model_validate(user).model_dump(mode="json")


def _get_user_by_uid(user_uid: str) -> User:
    user = db.session.scalar(select(User).where(User.user_uid == user_uid))
    if not user:
        raise NotFoundError(f"user {user_uid} not found")
    return user


@users_bp.get("")
@login_required
@require_roles("admin")
def list_users():
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 50, type=int)))
    q = (request.args.get("q") or "").strip()

    stmt = select(User)
    if q:
        like = f"%{q}%"
        stmt = stmt.where((User.email.ilike(like)) | (User.full_name.ilike(like)))

    total = db.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    items = db.session.scalars(
        stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    return jsonify(
        UserListResponse(
            items=[UserRead.model_validate(u) for u in items],
            page=page,
            page_size=page_size,
            total=total,
        ).model_dump(mode="json")
    )


@users_bp.post("")
@login_required
@require_roles("admin")
def create_user():
    data = _validate(UserCreate, request.get_json(silent=True) or {})

    user = User(
        tenant_id=current_user.tenant_id,
        user_uid=generate_user_uid(),
        email=data.email.lower(),
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        phone=data.phone,
        is_active=True,
    )
    db.session.add(user)

    try:
        db.session.flush()
    except IntegrityError as e:
        db.session.rollback()
        raise ConflictError("email already exists in this tenant", code="email_taken") from e

    if data.role_codes:
        roles = db.session.scalars(select(Role).where(Role.code.in_(data.role_codes))).all()
        for r in roles:
            db.session.add(UserRole(user_id=user.id, role_id=r.id))

    db.session.commit()
    db.session.refresh(user)
    return jsonify(_user_payload(user)), 201


@users_bp.get("/<string:user_uid>")
@login_required
@require_roles("admin")
def get_user(user_uid: str):
    user = _get_user_by_uid(user_uid)
    return jsonify(_user_payload(user))


@users_bp.patch("/<string:user_uid>")
@login_required
@require_roles("admin")
def update_user(user_uid: str):
    data = _validate(UserUpdate, request.get_json(silent=True) or {})
    user = _get_user_by_uid(user_uid)

    if data.full_name is not None:
        user.full_name = data.full_name
    if data.phone is not None:
        user.phone = data.phone
    if data.is_active is not None:
        user.is_active = data.is_active

    db.session.commit()
    db.session.refresh(user)
    return jsonify(_user_payload(user))


@users_bp.delete("/<string:user_uid>")
@login_required
@require_roles("admin")
def soft_delete_user(user_uid: str):
    user = _get_user_by_uid(user_uid)

    if user.id == current_user.id:
        raise ConflictError("cannot delete your own account", code="self_delete")

    user.deleted_at = datetime.now(UTC)
    db.session.commit()
    return "", 204


@users_bp.post("/<string:user_uid>/roles")
@login_required
@require_roles("admin")
def update_user_roles(user_uid: str):
    data = _validate(UserRolesUpdate, request.get_json(silent=True) or {})
    user = _get_user_by_uid(user_uid)

    db.session.execute(UserRole.__table__.delete().where(UserRole.user_id == user.id))

    if data.role_codes:
        roles = db.session.scalars(select(Role).where(Role.code.in_(data.role_codes))).all()
        for r in roles:
            db.session.add(UserRole(user_id=user.id, role_id=r.id))

    db.session.commit()
    db.session.refresh(user)
    return jsonify(_user_payload(user))
