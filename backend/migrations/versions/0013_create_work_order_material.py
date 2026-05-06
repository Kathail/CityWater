"""create work_order_material

Revision ID: 0013_wo_material
Revises: 0012_wo_time
Create Date: 2026-05-05 12:12:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_wo_material"
down_revision = "0012_wo_time"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_order_material",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("work_order_id", sa.BigInteger(), nullable=False),
        sa.Column("material_code", sa.String(length=64), nullable=True),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
        sa.Column("unit", sa.String(length=16), nullable=True),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["work_order_id"], ["work_order.id"],
            name="fk_work_order_material_work_order_id_work_order",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_work_order_material"),
        sa.CheckConstraint(
            "quantity >= 0", name="ck_work_order_material_qty_nonneg"
        ),
    )
    op.create_index(
        "ix_work_order_material_wo",
        "work_order_material",
        ["work_order_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_material_wo", table_name="work_order_material")
    op.drop_table("work_order_material")
