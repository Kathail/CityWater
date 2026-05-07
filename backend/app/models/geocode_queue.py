from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base


class GeocodeQueue(Base):
    """Pending reverse-geocode work, populated by an `asset` row trigger.

    The `flask geocode-tick` worker drains this table, calls a geocoder
    (currently a stub returning ``~lat,lon``), writes
    `asset.address_cached` + `address_cached_at`, and removes the queue
    row on success. Retries increment `attempts`; failures are logged
    via `last_error` so an operator can spot a sticky asset.
    """

    __tablename__ = "geocode_queue"
    __table_args__ = (UniqueConstraint("asset_id", name="uq_geocode_queue_asset_id"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset.id", ondelete="CASCADE"), nullable=False)
    enqueued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
