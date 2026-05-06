"""create comment

Revision ID: 0021_comment
Revises: 0020_links_schedules
Create Date: 2026-05-06 03:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_comment"
down_revision = "0020_links_schedules"
branch_labels = None
depends_on = None

# Mirror the entity_link enum so a comment can attach to any of the same
# top-level entities. Schedules are included — operators want to leave
# notes on a recurring template ("paused while pump is offline").
ENTITY_TYPES = ("work_order", "inspection", "service_request", "schedule")


def upgrade() -> None:
    op.create_table(
        "comment",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
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
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name="fk_comment_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["user.id"],
            name="fk_comment_created_by_user",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_comment"),
        sa.CheckConstraint(
            f"entity_type IN ({', '.join(repr(v) for v in ENTITY_TYPES)})",
            name="ck_comment_entity_type",
        ),
        sa.CheckConstraint("length(body) > 0", name="ck_comment_body_nonempty"),
    )
    op.create_index(
        "ix_comment_entity",
        "comment",
        ["tenant_id", "entity_type", "entity_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_comment_entity", table_name="comment")
    op.drop_table("comment")
