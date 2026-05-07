from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import TimestampMixin


class PacpCode(Base, TimestampMixin):
    """Global PACP code catalog. Not tenant-scoped — the codes are universal."""

    __tablename__ = "pacp_code"
    __table_args__ = (
        CheckConstraint(
            "default_severity IS NULL OR default_severity BETWEEN 1 AND 5",
            name="ck_pacp_code_severity",
        ),
        CheckConstraint(
            "\"group\" IN ('structural', 'om', 'construction', 'miscellaneous')",
            name="ck_pacp_code_group",
        ),
    )

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    description: Mapped[str] = mapped_column(String, nullable=False)
    group: Mapped[str] = mapped_column(String(32), nullable=False)
    is_structural: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_om: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    default_severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
