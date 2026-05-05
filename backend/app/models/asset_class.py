from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import TimestampMixin


class AssetClass(Base, TimestampMixin):
    """Global catalog of asset classes (shared across tenants).

    Per `docs/SPEC.md` §3.2. Tenant-specific overrides (icon/color/attribute_schema)
    are deferred — when needed they live in `tenant.settings.asset_class_overrides`.
    """

    __tablename__ = "asset_class"
    __table_args__ = (
        CheckConstraint(
            "domain IN ('water', 'sewer', 'storm')",
            name="ck_asset_class_domain",
        ),
        CheckConstraint(
            "geometry_type IN ('Point', 'LineString', 'Polygon')",
            name="ck_asset_class_geometry_type",
        ),
    )

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    domain: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    geometry_type: Mapped[str] = mapped_column(String(16), nullable=False)
    attribute_schema: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    default_criticality: Mapped[int | None] = mapped_column(Integer, nullable=True)
    icon: Mapped[str | None] = mapped_column(String, nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
