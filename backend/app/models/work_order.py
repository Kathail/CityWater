from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
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

VALID_TYPES: tuple[str, ...] = ("planned", "reactive")
VALID_CATEGORIES: tuple[str, ...] = (
    "main_break",
    "flushing",
    "valve_exercise",
    "cleaning",
    "inspection",
    "repair",
    "install",
    "other",
)
VALID_PRIORITIES: tuple[str, ...] = ("low", "normal", "high", "emergency")
VALID_STATUSES: tuple[str, ...] = (
    "draft",
    "open",
    "assigned",
    "in_progress",
    "on_hold",
    "completed",
    "cancelled",
)
VALID_ATTACHMENT_KINDS: tuple[str, ...] = ("photo", "doc", "sketch")


def _enum_check(values: tuple[str, ...], column: str) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class WorkOrder(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin):
    __tablename__ = "work_order"
    __table_args__ = (
        UniqueConstraint("tenant_id", "wo_number", name="uq_work_order_tenant_id_wo_number"),
        CheckConstraint(_enum_check(VALID_TYPES, "type"), name="ck_work_order_type"),
        CheckConstraint(_enum_check(VALID_CATEGORIES, "category"), name="ck_work_order_category"),
        CheckConstraint(_enum_check(VALID_PRIORITIES, "priority"), name="ck_work_order_priority"),
        CheckConstraint(_enum_check(VALID_STATUSES, "status"), name="ck_work_order_status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    wo_number: Mapped[str] = mapped_column(String(32), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    priority: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    asset_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("asset.id", ondelete="SET NULL"), nullable=True
    )
    location: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=True
    )
    template_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reported_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    assigned_to: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    crew_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("crew.id", ondelete="SET NULL"), nullable=True
    )
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    attrs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

    tasks: Mapped[list[WorkOrderTask]] = relationship(
        "WorkOrderTask",
        cascade="all, delete-orphan",
        order_by="WorkOrderTask.sequence, WorkOrderTask.id",
        lazy="selectin",
    )
    time_logs: Mapped[list[WorkOrderTimeLog]] = relationship(
        "WorkOrderTimeLog",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    materials: Mapped[list[WorkOrderMaterial]] = relationship(
        "WorkOrderMaterial",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    attachments: Mapped[list[WorkOrderAttachment]] = relationship(
        "WorkOrderAttachment",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class WorkOrderTask(Base, TimestampMixin, AuditableMixin):
    __tablename__ = "work_order_task"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_order.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_complete: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class WorkOrderTimeLog(Base, TimestampMixin, AuditableMixin):
    __tablename__ = "work_order_time_log"
    __table_args__ = (
        CheckConstraint("ended_at >= started_at", name="ck_work_order_time_log_order"),
        CheckConstraint("hours_decimal >= 0", name="ck_work_order_time_log_nonneg"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_order.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="RESTRICT"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    hours_decimal: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkOrderMaterial(Base, TimestampMixin, AuditableMixin):
    __tablename__ = "work_order_material"
    __table_args__ = (CheckConstraint("quantity >= 0", name="ck_work_order_material_qty_nonneg"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_order.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    material_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)


class WorkOrderAttachment(Base, TimestampMixin, AuditableMixin):
    __tablename__ = "work_order_attachment"
    __table_args__ = (
        CheckConstraint(
            _enum_check(VALID_ATTACHMENT_KINDS, "kind"),
            name="ck_work_order_attachment_kind",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_order.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    s3_key: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    geo: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=True
    )
    uploaded_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
