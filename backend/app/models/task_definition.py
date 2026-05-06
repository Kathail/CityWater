from __future__ import annotations

from typing import Any

from sqlalchemy import (
    ARRAY,
    BigInteger,
    CheckConstraint,
    Identity,
    Integer,
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

VALID_PRODUCES: tuple[str, ...] = ("work_order", "inspection", "service_request")
VALID_STATUSES: tuple[str, ...] = ("draft", "active", "archived")
VALID_DOMAINS: tuple[str, ...] = ("water", "sewer", "storm", "any")


class TaskDefinition(Base, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, AuditableMixin):
    """A task definition is the operator-facing recipe for one kind of
    work: how the form looks, how prefill flows, what completion means,
    what spawns afterward. Versioned per (tenant_id, code).

    Only one row per (tenant_id, code) may have status='active' at a time
    (enforced by partial unique index `ux_task_def_one_active_per_code`)."""

    __tablename__ = "task_definition"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "code", "version", name="uq_task_definition_tenant_code_version"
        ),
        CheckConstraint(
            f"produces IN ({', '.join(repr(v) for v in VALID_PRODUCES)})",
            name="ck_task_definition_produces",
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in VALID_STATUSES)})",
            name="ck_task_definition_status",
        ),
        CheckConstraint(
            "default_domain IS NULL OR default_domain IN "
            f"({', '.join(repr(v) for v in VALID_DOMAINS)})",
            name="ck_task_definition_default_domain",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    produces: Mapped[str] = mapped_column(String(32), nullable=False)
    default_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    default_priority: Mapped[str | None] = mapped_column(String(16), nullable=True)
    default_domain: Mapped[str | None] = mapped_column(String(16), nullable=True)
    applies_to_classes: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), nullable=False, default=list, server_default="{}"
    )
    triggers: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    prefill: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    form: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    canned_comments: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    procedure: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    completion: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    spawns: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    clocks: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    lang: Mapped[str] = mapped_column(String(8), nullable=False, default="en", server_default="en")
    # TimestampMixin / SoftDeleteMixin already supply created_at / updated_at /
    # deleted_at, so we don't redeclare them here.

    def __repr__(self) -> str:
        return f"TaskDefinition(code={self.code!r}, version={self.version}, status={self.status!r})"
