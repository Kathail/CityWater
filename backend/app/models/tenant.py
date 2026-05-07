from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Identity, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import AuditableMixin, TimestampMixin


class Tenant(Base, TimestampMixin, AuditableMixin):
    __tablename__ = "tenant"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
