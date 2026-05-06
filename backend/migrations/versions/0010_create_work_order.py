"""create work_order

Revision ID: 0010_work_order
Revises: 0009_crew
Create Date: 2026-05-05 12:09:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision = "0010_work_order"
down_revision = "0009_crew"
branch_labels = None
depends_on = None

VALID_TYPES = ("planned", "reactive")
VALID_CATEGORIES = (
    "main_break",
    "flushing",
    "valve_exercise",
    "cleaning",
    "inspection",
    "repair",
    "install",
    "other",
)
VALID_PRIORITIES = ("low", "normal", "high", "emergency")
VALID_STATUSES = (
    "draft",
    "open",
    "assigned",
    "in_progress",
    "on_hold",
    "completed",
    "cancelled",
)


def _check(values: tuple[str, ...]) -> str:
    return "'" + "', '".join(values) + "'"


def upgrade() -> None:
    op.create_table(
        "work_order",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("wo_number", sa.String(length=32), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default="draft", nullable=False
        ),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("asset_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "location", Geometry(geometry_type="POINT", srid=4326), nullable=True
        ),
        sa.Column("template_id", sa.BigInteger(), nullable=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_by", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reported_by", sa.BigInteger(), nullable=True),
        sa.Column("assigned_to", sa.BigInteger(), nullable=True),
        sa.Column("crew_id", sa.BigInteger(), nullable=True),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column(
            "attrs", postgresql.JSONB(), server_default="{}", nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], name="fk_work_order_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["asset.id"], name="fk_work_order_asset_id_asset",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reported_by"], ["user.id"], name="fk_work_order_reported_by_user",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["assigned_to"], ["user.id"], name="fk_work_order_assigned_to_user",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["crew_id"], ["crew.id"], name="fk_work_order_crew_id_crew",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_work_order"),
        sa.UniqueConstraint(
            "tenant_id", "wo_number", name="uq_work_order_tenant_id_wo_number"
        ),
        sa.CheckConstraint(
            f"type IN ({_check(VALID_TYPES)})", name="ck_work_order_type"
        ),
        sa.CheckConstraint(
            f"category IN ({_check(VALID_CATEGORIES)})",
            name="ck_work_order_category",
        ),
        sa.CheckConstraint(
            f"priority IN ({_check(VALID_PRIORITIES)})",
            name="ck_work_order_priority",
        ),
        sa.CheckConstraint(
            f"status IN ({_check(VALID_STATUSES)})", name="ck_work_order_status"
        ),
    )
    op.create_index("ix_work_order_tenant_id", "work_order", ["tenant_id"])
    op.create_index(
        "ix_work_order_active",
        "work_order",
        ["tenant_id", "status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_work_order_assigned",
        "work_order",
        ["tenant_id", "assigned_to"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_work_order_location",
        "work_order",
        ["location"],
        postgresql_using="gist",
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_location", table_name="work_order")
    op.drop_index("ix_work_order_assigned", table_name="work_order")
    op.drop_index("ix_work_order_active", table_name="work_order")
    op.drop_index("ix_work_order_tenant_id", table_name="work_order")
    op.drop_table("work_order")
