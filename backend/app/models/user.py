from __future__ import annotations

from datetime import datetime

from flask_login import UserMixin
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Identity,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import Base
from app.models.mixins import (
    AuditableMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    TimestampMixin,
)


class Role(Base, TenantScopedMixin, TimestampMixin, AuditableMixin):
    __tablename__ = "role"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_role_tenant_id_code"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)


class User(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin, UserMixin):
    __tablename__ = "user"
    __table_args__ = (UniqueConstraint("tenant_id", "email", name="uq_user_tenant_id_email"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    user_uid: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    roles: Mapped[list[Role]] = relationship(
        "Role",
        secondary="user_role",
        lazy="selectin",
    )

    def get_id(self) -> str:
        return str(self.id)


class UserRole(Base):
    __tablename__ = "user_role"

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("user.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("role.id", ondelete="CASCADE"),
        primary_key=True,
    )
