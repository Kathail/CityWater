from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TenantScopedMixin:
    """Marker + tenant_id column. Tenant filter listener auto-scopes queries."""

    @declared_attr
    @classmethod
    def tenant_id(cls) -> Mapped[int]:
        return mapped_column(
            BigInteger,
            ForeignKey("tenant.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        )


class AuditableMixin:
    """Marker — instances of this model are written to audit_log on flush."""
