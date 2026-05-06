"""Invitation endpoints.

Admin-only create/list/revoke under `/api/v1/invitations`. The accept
endpoint is public (CSRF-exempt, no login) so a recipient with a token
can finalize their account.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from flask import Blueprint, current_app, g, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import csrf, db, limiter
from app.models import Invitation, Role, Tenant, User, UserRole
from app.schemas.invitation import (
    InvitationAccept,
    InvitationCreate,
    InvitationCreateResponse,
    InvitationListResponse,
    InvitationRead,
)
from app.services.audit import emit_event
from app.services.auth import hash_password
from app.services.email import send_invitation_email
from app.services.invitations import generate_token, token_prefix, verify_token
from app.services.permissions import require_roles
from app.utils.uids import generate_user_uid

logger = logging.getLogger(__name__)

invitations_bp = Blueprint("invitations", __name__, url_prefix="/api/v1/invitations")


def _validate(model_cls, data):
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _accept_url(token: str) -> str:
    settings = current_app.config["SETTINGS"]
    base = settings.public_base_url or request.host_url.rstrip("/")
    return f"{base}/accept-invitation/{token}"


def _accept_limit() -> str:
    return current_app.config["SETTINGS"].rate_limit_invite_accept


def _payload(inv: Invitation) -> dict:
    return InvitationRead.model_validate(inv).model_dump(mode="json")


@invitations_bp.get("")
@login_required
@require_roles("admin")
def list_invitations():
    items = db.session.scalars(select(Invitation).order_by(Invitation.created_at.desc())).all()
    return jsonify(
        InvitationListResponse(items=[InvitationRead.model_validate(i) for i in items]).model_dump(
            mode="json"
        )
    )


@invitations_bp.post("")
@login_required
@require_roles("admin")
def create_invitation():
    data = _validate(InvitationCreate, request.get_json(silent=True) or {})
    email = data.email.lower()

    # Reject if there's an active (unaccepted, unrevoked, unexpired) invite
    # for this email, OR an existing user with this email in the tenant.
    existing_user = db.session.scalar(
        select(User).where(User.email == email).execution_options(skip_tenant_filter=False)
    )
    if existing_user:
        raise ConflictError(
            "a user with this email already exists in your tenant",
            code="email_taken",
        )

    now = datetime.now(UTC)
    pending = db.session.scalar(
        select(Invitation).where(
            Invitation.email == email,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > now,
        )
    )
    if pending:
        raise ConflictError(
            "an active invitation already exists for this email; revoke it first",
            code="invite_pending",
        )

    # Validate role codes belong to this tenant.
    if data.role_codes:
        roles = db.session.scalars(select(Role).where(Role.code.in_(data.role_codes))).all()
        if len(roles) != len(set(data.role_codes)):
            raise ValidationError(
                "one or more role codes are unknown",
                code="unknown_role",
            )

    raw_token, hashed, prefix = generate_token()
    inv = Invitation(
        tenant_id=current_user.tenant_id,
        email=email,
        full_name=data.full_name,
        token_hash=hashed,
        token_prefix=prefix,
        invited_by=current_user.id,
        role_codes=list(data.role_codes),
        expires_at=now + timedelta(days=data.expires_in_days),
    )
    db.session.add(inv)
    db.session.flush()

    accept_url = _accept_url(raw_token)
    emit_event(
        action="invitation_create",
        entity_type="Invitation",
        entity_id=str(inv.id),
        tenant_id=inv.tenant_id,
        after={
            "email": inv.email,
            "role_codes": inv.role_codes,
            "expires_at": inv.expires_at.isoformat(),
        },
    )
    db.session.commit()
    db.session.refresh(inv)

    # Send the invitation. The email driver is settings-driven (`stdout`
    # default, `resend` when wired). Failure to send shouldn't roll back
    # the row — the admin UI shows the accept URL for manual delivery.
    tenant_obj = db.session.get(Tenant, inv.tenant_id)
    try:
        send_invitation_email(
            to=inv.email,
            accept_url=accept_url,
            tenant_name=tenant_obj.name if tenant_obj else "FlowOps",
        )
    except Exception:
        logger.exception(
            "invitation email send failed; admin can copy the accept_url manually",
        )

    return (
        jsonify(
            InvitationCreateResponse(
                invitation=InvitationRead.model_validate(inv),
                token=raw_token,
                accept_url=accept_url,
            ).model_dump(mode="json")
        ),
        201,
    )


@invitations_bp.delete("/<int:invitation_id>")
@login_required
@require_roles("admin")
def revoke_invitation(invitation_id: int):
    inv = db.session.get(Invitation, invitation_id)
    if not inv:
        raise NotFoundError(f"invitation {invitation_id} not found")
    if inv.accepted_at is not None:
        raise ConflictError(
            "invitation already accepted; remove the user instead",
            code="already_accepted",
        )
    if inv.revoked_at is not None:
        return jsonify(_payload(inv))

    inv.revoked_at = datetime.now(UTC)
    emit_event(
        action="invitation_revoke",
        entity_type="Invitation",
        entity_id=str(inv.id),
        tenant_id=inv.tenant_id,
        after={"email": inv.email},
    )
    db.session.commit()
    db.session.refresh(inv)
    return jsonify(_payload(inv))


@invitations_bp.post("/accept")
@csrf.exempt
@limiter.limit(_accept_limit)
def accept_invitation():
    """Public endpoint — recipient submits token + new password.

    The endpoint is rate-limit naive in v1 (S12 hardening adds Flask-Limiter
    on the auth + accept routes). Token verification is constant-time via
    argon2.
    """
    data = _validate(InvitationAccept, request.get_json(silent=True) or {})

    g.skip_tenant_filter = True

    prefix = token_prefix(data.token)
    candidates = db.session.scalars(
        select(Invitation).where(
            Invitation.token_prefix == prefix,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
    ).all()
    inv: Invitation | None = None
    for candidate in candidates:
        if verify_token(data.token, candidate.token_hash):
            inv = candidate
            break

    if not inv:
        raise ValidationError("invalid or expired invitation", code="bad_token")
    if inv.expires_at <= datetime.now(UTC):
        raise ValidationError("invitation has expired", code="expired_token")

    # Check for an existing user with the same email in the tenant — the
    # admin may have created one manually since the invite was sent.
    existing = db.session.scalar(
        select(User).where(User.tenant_id == inv.tenant_id, User.email == inv.email)
    )
    if existing:
        raise ConflictError(
            "a user with this email already exists",
            code="email_taken",
        )

    user = User(
        tenant_id=inv.tenant_id,
        user_uid=generate_user_uid(),
        email=inv.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        is_active=True,
    )
    db.session.add(user)
    try:
        db.session.flush()
    except IntegrityError as e:
        db.session.rollback()
        raise ConflictError("could not create user", code="user_create_failed") from e

    if inv.role_codes:
        roles = db.session.scalars(
            select(Role).where(
                Role.tenant_id == inv.tenant_id,
                Role.code.in_(inv.role_codes),
            )
        ).all()
        for r in roles:
            db.session.add(UserRole(user_id=user.id, role_id=r.id))

    inv.accepted_at = datetime.now(UTC)
    inv.accepted_user_id = user.id

    emit_event(
        action="invitation_accept",
        entity_type="Invitation",
        entity_id=str(inv.id),
        tenant_id=inv.tenant_id,
        user_id=user.id,
        after={"email": inv.email, "user_uid": user.user_uid},
    )
    db.session.commit()

    # Hint to the frontend so it can route to /login with the slug pre-filled.
    tenant = db.session.get(Tenant, inv.tenant_id)
    return (
        jsonify(
            {
                "ok": True,
                "tenant_slug": tenant.slug if tenant else None,
                "email": user.email,
            }
        ),
        201,
    )
