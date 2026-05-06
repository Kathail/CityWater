from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Identity, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import Base
from app.models.mixins import AuditableMixin, TenantScopedMixin, TimestampMixin


class WoTemplate(Base, TenantScopedMixin, TimestampMixin, AuditableMixin):
    __tablename__ = "wo_template"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_wo_template_tenant_id_name"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    default_priority: Mapped[str] = mapped_column(String(16), nullable=False)
    applies_to_classes: Mapped[list[str]] = mapped_column(
        ARRAY(String(32)), nullable=False, default=list, server_default="{}"
    )
    task_template: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
