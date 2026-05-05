from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
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
from app.models.asset_class import AssetClass
from app.models.mixins import (
    AuditableMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    TimestampMixin,
)

VALID_STATUSES: tuple[str, ...] = ("active", "abandoned", "removed", "proposed")


class Asset(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin):
    __tablename__ = "asset"
    __table_args__ = (
        UniqueConstraint("tenant_id", "asset_uid", name="uq_asset_tenant_id_asset_uid"),
        CheckConstraint(
            "condition IS NULL OR condition BETWEEN 1 AND 5",
            name="ck_asset_condition",
        ),
        CheckConstraint(
            "criticality IS NULL OR criticality BETWEEN 1 AND 5",
            name="ck_asset_criticality",
        ),
        CheckConstraint(
            "status IN ('active', 'abandoned', 'removed', 'proposed')",
            name="ck_asset_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    asset_uid: Mapped[str] = mapped_column(String, nullable=False)
    class_code: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("asset_class.code", name="fk_asset_class_code_asset_class"),
        nullable=False,
        index=True,
    )
    geom: Mapped[Any] = mapped_column(Geometry(geometry_type="GEOMETRY", srid=4326), nullable=False)
    install_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    decommission_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    material: Mapped[str | None] = mapped_column(String, nullable=True)
    diameter_mm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    length_m: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    depth_m: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String, nullable=True)
    warranty_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    condition: Mapped[int | None] = mapped_column(Integer, nullable=True)
    criticality: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )
    attrs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    asset_class: Mapped[AssetClass] = relationship("AssetClass", lazy="joined")
