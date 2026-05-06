"""create crew + crew_member

Revision ID: 0009_crew
Revises: 0008_assets_mvt
Create Date: 2026-05-05 12:08:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_crew"
down_revision = "0008_assets_mvt"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "crew",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("lead_user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.true(), nullable=False
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
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], name="fk_crew_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["lead_user_id"], ["user.id"], name="fk_crew_lead_user_id_user",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_crew"),
    )
    op.create_index("ix_crew_tenant_id", "crew", ["tenant_id"])

    op.create_table(
        "crew_member",
        sa.Column("crew_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["crew_id"], ["crew.id"], name="fk_crew_member_crew_id_crew",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_crew_member_user_id_user",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("crew_id", "user_id", name="pk_crew_member"),
    )


def downgrade() -> None:
    op.drop_table("crew_member")
    op.drop_index("ix_crew_tenant_id", table_name="crew")
    op.drop_table("crew")
