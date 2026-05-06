"""create work_order_time_log

Revision ID: 0012_wo_time
Revises: 0011_wo_task
Create Date: 2026-05-05 12:11:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_wo_time"
down_revision = "0011_wo_task"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_order_time_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("work_order_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hours_decimal", sa.Numeric(7, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
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
            name="fk_work_order_time_log_work_order_id_work_order",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"],
            name="fk_work_order_time_log_user_id_user",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_work_order_time_log"),
        sa.CheckConstraint(
            "ended_at >= started_at", name="ck_work_order_time_log_order"
        ),
        sa.CheckConstraint(
            "hours_decimal >= 0", name="ck_work_order_time_log_nonneg"
        ),
    )
    op.create_index(
        "ix_work_order_time_log_wo",
        "work_order_time_log",
        ["work_order_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_time_log_wo", table_name="work_order_time_log")
    op.drop_table("work_order_time_log")
