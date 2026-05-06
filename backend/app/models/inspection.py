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
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import Base
from app.models.mixins import (
    AuditableMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    TimestampMixin,
)

VALID_KINDS: tuple[str, ...] = (
    "cctv",
    "hydrant_flow",
    "valve_exercise",
    "manhole",
    "catch_basin",
    "lift_station_round",
)


class Inspection(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin):
    __tablename__ = "inspection"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "inspection_number",
            name="uq_inspection_tenant_id_inspection_number",
        ),
        CheckConstraint(
            "kind IN (" + ", ".join(repr(k) for k in VALID_KINDS) + ")",
            name="ck_inspection_kind",
        ),
        CheckConstraint(
            "overall_condition IS NULL OR overall_condition BETWEEN 1 AND 5",
            name="ck_inspection_overall_condition",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    inspection_number: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    asset_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("asset.id", ondelete="SET NULL"), nullable=True
    )
    work_order_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("work_order.id", ondelete="SET NULL"), nullable=True
    )
    schedule_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("schedule.id", ondelete="SET NULL"), nullable=True
    )
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    performed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    overall_condition: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pass_: Mapped[bool | None] = mapped_column("pass", Boolean, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    attrs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

    asset_obj: Mapped[Asset | None] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Asset", foreign_keys=[asset_id], lazy="joined"
    )
    work_order_obj: Mapped[WorkOrder | None] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "WorkOrder", foreign_keys=[work_order_id], lazy="joined"
    )
