"""create work_order_task

Revision ID: 0011_wo_task
Revises: 0010_work_order
Create Date: 2026-05-05 12:10:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_wo_task"
down_revision = "0010_work_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_order_task",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("work_order_id", sa.BigInteger(), nullable=False),
        sa.Column("sequence", sa.Integer(), server_default="0", nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_complete", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_by", sa.BigInteger(), nullable=True),
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
            name="fk_work_order_task_work_order_id_work_order",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["completed_by"], ["user.id"],
            name="fk_work_order_task_completed_by_user",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_work_order_task"),
    )
    op.create_index(
        "ix_work_order_task_work_order_id",
        "work_order_task",
        ["work_order_id", "sequence"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_task_work_order_id", table_name="work_order_task")
    op.drop_table("work_order_task")
