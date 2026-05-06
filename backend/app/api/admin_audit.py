"""Admin endpoint for audit log retention cleanup.

Per SPEC §8 NFRs, the default audit retention is 7 years (~2555 days). This
endpoint is invoked from a runbook (or a scheduled CronJob in production) to
delete records older than the configured window — admin-only, audited as a
single `audit_retention_cleanup` event so the deletion itself stays
discoverable.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func, select

from app.errors import ValidationError
from app.extensions import db
from app.models import AuditLog
from app.services.audit import emit_event
from app.services.permissions import require_roles

admin_audit_bp = Blueprint("admin_audit", __name__, url_prefix="/api/v1/admin/audit-log")

DEFAULT_RETENTION_DAYS = 2555  # ~7 years


@admin_audit_bp.post("/cleanup")
@login_required
@require_roles("admin")
def cleanup() -> tuple:
    raw = request.args.get("older_than_days") or str(DEFAULT_RETENTION_DAYS)
    try:
        days = int(raw)
    except ValueError as e:
        raise ValidationError("older_than_days must be an integer", code="bad_days") from e
    if days < 30:
        raise ValidationError(
            "minimum retention window is 30 days; refusing to delete anything more recent",
            code="too_aggressive",
        )

    cutoff = datetime.now(UTC) - timedelta(days=days)
    # Only purge events for the caller's tenant — cross-tenant cleanup is
    # not allowed even for admins. Tenant-null events (e.g. failed logins
    # before the user is bound) are left alone.
    candidates = db.session.execute(
        select(func.count(AuditLog.id)).where(
            AuditLog.tenant_id == current_user.tenant_id,
            AuditLog.occurred_at < cutoff,
        )
    ).scalar_one()

    deleted = (
        db.session.query(AuditLog)
        .filter(
            AuditLog.tenant_id == current_user.tenant_id,
            AuditLog.occurred_at < cutoff,
        )
        .delete(synchronize_session=False)
    )

    emit_event(
        action="audit_retention_cleanup",
        entity_type="AuditLog",
        entity_id="*",
        tenant_id=current_user.tenant_id,
        after={
            "older_than_days": days,
            "cutoff": cutoff.isoformat(),
            "deleted": deleted,
        },
    )
    db.session.commit()

    return (
        jsonify(
            {
                "older_than_days": days,
                "cutoff": cutoff.isoformat(),
                "matched": int(candidates),
                "deleted": int(deleted),
            }
        ),
        200,
    )
