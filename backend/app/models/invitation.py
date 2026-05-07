from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    DateTime,
    ForeignKey,
    Identity,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import AuditableMixin, TenantScopedMixin, TimestampMixin


class Invitation(Base, TenantScopedMixin, TimestampMixin, AuditableMixin):
    __tablename__ = "invitation"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "email",
            "accepted_at",
            name="uq_invitation_tenant_email_accepted",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(12), nullable=False)
    invited_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    role_codes: Mapped[list[str]] = mapped_column(ARRAY(String(32)), nullable=False, default=list, server_default="{}")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
