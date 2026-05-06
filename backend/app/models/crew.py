from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, Identity, String
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import AuditableMixin, TenantScopedMixin, TimestampMixin


class Crew(Base, TenantScopedMixin, TimestampMixin, AuditableMixin):
    __tablename__ = "crew"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    lead_user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )


class CrewMember(Base):
    __tablename__ = "crew_member"

    crew_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("crew.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("user.id", ondelete="CASCADE"),
        primary_key=True,
    )
