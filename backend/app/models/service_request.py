from __future__ import annotations

from datetime import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    String,
    Text,
    UniqueConstraint,
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

VALID_CATEGORIES: tuple[str, ...] = (
    "low_pressure",
    "no_water",
    "sewer_backup",
    "flooding",
    "odour",
    "damaged_asset",
    "other",
)
VALID_DOMAINS: tuple[str, ...] = ("water", "sewer", "storm")
VALID_STATUSES: tuple[str, ...] = (
    "new",
    "triaged",
    "dispatched",
    "closed",
    "duplicate",
)
VALID_PRIORITIES: tuple[str, ...] = ("low", "normal", "high", "emergency")
VALID_CLOSURE_REASONS: tuple[str, ...] = (
    "resolved",
    "duplicate",
    "no_action",
    "false_alarm",
    "deferred",
)


def _enum(values: tuple[str, ...], column: str) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class ServiceRequest(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin):
    __tablename__ = "service_request"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sr_number", name="uq_service_request_tenant_id_sr_number"),
        CheckConstraint(_enum(VALID_CATEGORIES, "category"), name="ck_service_request_category"),
        CheckConstraint(_enum(VALID_DOMAINS, "domain"), name="ck_service_request_domain"),
        CheckConstraint(_enum(VALID_STATUSES, "status"), name="ck_service_request_status"),
        CheckConstraint(_enum(VALID_PRIORITIES, "priority"), name="ck_service_request_priority"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    sr_number: Mapped[str] = mapped_column(String(32), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    domain: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="new", server_default="new"
    )
    priority: Mapped[str] = mapped_column(
        String(16), nullable=False, default="normal", server_default="normal"
    )
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    caller_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    caller_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    caller_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    intake_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    work_order_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("work_order.id", ondelete="SET NULL"), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closure_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    closure_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    duplicate_of_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("service_request.id", ondelete="SET NULL"),
        nullable=True,
    )
    attrs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
