"""create inspection

Revision ID: 0016_inspection
Revises: 0015_wo_template
Create Date: 2026-05-05 12:15:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016_inspection"
down_revision = "0015_wo_template"
branch_labels = None
depends_on = None

VALID_KINDS = (
    "cctv",
    "hydrant_flow",
    "valve_exercise",
    "manhole",
    "catch_basin",
    "lift_station_round",
)


def upgrade() -> None:
    op.create_table(
        "inspection",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("inspection_number", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("asset_id", sa.BigInteger(), nullable=True),
        sa.Column("work_order_id", sa.BigInteger(), nullable=True),
        sa.Column("performed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("performed_by", sa.BigInteger(), nullable=True),
        sa.Column("overall_condition", sa.Integer(), nullable=True),
        sa.Column("pass", sa.Boolean(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "data", postgresql.JSONB(), server_default="{}", nullable=False
        ),
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
            ["tenant_id"], ["tenant.id"], name="fk_inspection_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["asset.id"], name="fk_inspection_asset_id_asset",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["work_order_id"], ["work_order.id"],
            name="fk_inspection_work_order_id_work_order",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["performed_by"], ["user.id"],
            name="fk_inspection_performed_by_user",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_inspection"),
        sa.UniqueConstraint(
            "tenant_id",
            "inspection_number",
            name="uq_inspection_tenant_id_inspection_number",
        ),
        sa.CheckConstraint(
            "kind IN (" + ", ".join(repr(k) for k in VALID_KINDS) + ")",
            name="ck_inspection_kind",
        ),
        sa.CheckConstraint(
            "overall_condition IS NULL OR overall_condition BETWEEN 1 AND 5",
            name="ck_inspection_overall_condition",
        ),
    )
    op.create_index("ix_inspection_tenant_id_kind", "inspection", ["tenant_id", "kind"])
    op.create_index(
        "ix_inspection_asset",
        "inspection",
        ["tenant_id", "asset_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_inspection_data",
        "inspection",
        ["data"],
        postgresql_using="gin",
        postgresql_ops={"data": "jsonb_path_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_inspection_data", table_name="inspection")
    op.drop_index("ix_inspection_asset", table_name="inspection")
    op.drop_index("ix_inspection_tenant_id_kind", table_name="inspection")
    op.drop_table("inspection")
