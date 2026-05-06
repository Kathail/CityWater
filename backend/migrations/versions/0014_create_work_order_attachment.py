"""create work_order_attachment

Revision ID: 0014_wo_attachment
Revises: 0013_wo_material
Create Date: 2026-05-05 12:13:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry

revision = "0014_wo_attachment"
down_revision = "0013_wo_material"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_order_attachment",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("work_order_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("original_filename", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "geo", Geometry(geometry_type="POINT", srid=4326), nullable=True
        ),
        sa.Column("uploaded_by", sa.BigInteger(), nullable=True),
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
            name="fk_work_order_attachment_work_order_id_work_order",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by"], ["user.id"],
            name="fk_work_order_attachment_uploaded_by_user",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_work_order_attachment"),
        sa.CheckConstraint(
            "kind IN ('photo', 'doc', 'sketch')",
            name="ck_work_order_attachment_kind",
        ),
    )
    op.create_index(
        "ix_work_order_attachment_wo",
        "work_order_attachment",
        ["work_order_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_work_order_attachment_wo", table_name="work_order_attachment"
    )
    op.drop_table("work_order_attachment")
