from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import (
    AuditableMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    TimestampMixin,
)

SCHEDULE_KINDS: tuple[str, ...] = ("work_order", "inspection")


class Schedule(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin):
    """Recurring work-order or inspection generator.

    `rrule` is an RFC 5545 RRULE string ("FREQ=MONTHLY;BYMONTHDAY=1"). When the
    `flask schedules-tick` CLI fires (cron-driven), it walks every active row
    where `next_run_at <= now()`, builds a WorkOrder/Inspection from `spec`,
    stamps `schedule_id` on the new instance, and advances `next_run_at` to
    the next rrule occurrence after now.
    """

    __tablename__ = "schedule"
    __table_args__ = (
        CheckConstraint(
            f"kind IN ({', '.join(repr(v) for v in SCHEDULE_KINDS)})",
            name="ck_schedule_kind",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    rrule: Mapped[str] = mapped_column(Text, nullable=False)
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    asset_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset.id", ondelete="SET NULL"), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
