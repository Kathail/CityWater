from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import TenantScopedMixin

WO_ASSET_ROLES: tuple[str, ...] = ("primary", "affected", "isolated_by", "witness")


class WorkOrderAsset(Base, TenantScopedMixin):
    """M:N between work_order and asset, with a role tag.

    `role='primary'` is the canonical "this is THE asset for this WO" link
    and there's a partial unique index ensuring at most one primary per WO.
    The `work_order.asset_id` shortcut column mirrors the primary; the
    service layer is responsible for keeping them in sync (no DB trigger).

    For routes (hydrant flushing, valve exercising, sewer cleaning), one
    WO carries N assets with a `sequence` ordering and per-stop
    completion. A WO with > 3 stops renders as a route view in the UI.
    """

    __tablename__ = "work_order_asset"
    __table_args__ = (
        CheckConstraint(
            f"role IN ({', '.join(repr(r) for r in WO_ASSET_ROLES)})",
            name="ck_work_order_asset_role",
        ),
    )

    work_order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_order.id", ondelete="CASCADE"),
        primary_key=True,
    )
    asset_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("asset.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    # tenant_id comes from TenantScopedMixin — that's what brings this
    # join table under the session-level tenant filter listener. The
    # column was denormalised onto this table in migration 0029 so the
    # listener has something to filter by; the mixin makes the listener
    # actually apply.
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="affected", server_default="affected")
    sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completion_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Per-asset structured observations. The frontend renders these
    # against the parent WO's task definition `form` and rolls them
    # back up into smart_comments — operator records numbers, the
    # narrative comment writes itself.
    task_data: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
