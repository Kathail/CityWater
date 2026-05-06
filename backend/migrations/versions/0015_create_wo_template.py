"""create wo_template

Revision ID: 0015_wo_template
Revises: 0014_wo_attachment
Create Date: 2026-05-05 12:14:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0015_wo_template"
down_revision = "0014_wo_attachment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wo_template",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("default_priority", sa.String(length=16), nullable=False),
        sa.Column(
            "applies_to_classes",
            postgresql.ARRAY(sa.String(length=32)),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "task_template",
            postgresql.JSONB(),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("instructions", sa.Text(), nullable=True),
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
            ["tenant_id"], ["tenant.id"], name="fk_wo_template_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_wo_template"),
        sa.UniqueConstraint(
            "tenant_id", "name", name="uq_wo_template_tenant_id_name"
        ),
    )
    op.create_index("ix_wo_template_tenant_id", "wo_template", ["tenant_id"])

    # Add the FK from work_order.template_id → wo_template.id (deferred from
    # 0010 to avoid circular dependency).
    op.create_foreign_key(
        "fk_work_order_template_id_wo_template",
        "work_order",
        "wo_template",
        ["template_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_work_order_template_id_wo_template",
        "work_order",
        type_="foreignkey",
    )
    op.drop_index("ix_wo_template_tenant_id", table_name="wo_template")
    op.drop_table("wo_template")
