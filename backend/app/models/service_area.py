from __future__ import annotations

from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
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

VALID_KINDS: tuple[str, ...] = (
    "maintenance",
    "water_system",
    "sewer_system",
    "storm_system",
)


class ServiceArea(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin):
    """Polygon-bearing operational area: a maintenance district, a
    water distribution system, a sewer collection system, or a storm
    drainage system. Tenants typically carry several of each."""

    __tablename__ = "service_area"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_service_area_tenant_code"),
        CheckConstraint(
            f"kind IN ({', '.join(repr(k) for k in VALID_KINDS)})",
            name="ck_service_area_kind",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    geom: Mapped[Any] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("service_area.id", ondelete="SET NULL"), nullable=True
    )
    attrs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
