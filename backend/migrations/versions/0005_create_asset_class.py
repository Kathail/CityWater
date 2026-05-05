"""create asset_class

Revision ID: 0005_asset_class
Revises: 0004_audit_log
Create Date: 2026-05-05 12:04:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_asset_class"
down_revision = "0004_audit_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_class",
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("domain", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("geometry_type", sa.String(length=16), nullable=False),
        sa.Column(
            "attribute_schema",
            postgresql.JSONB(),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("default_criticality", sa.Integer(), nullable=True),
        sa.Column("icon", sa.String(), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=True),
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
        sa.PrimaryKeyConstraint("code", name="pk_asset_class"),
        sa.CheckConstraint(
            "domain IN ('water', 'sewer', 'storm')", name="ck_asset_class_domain"
        ),
        sa.CheckConstraint(
            "geometry_type IN ('Point', 'LineString', 'Polygon')",
            name="ck_asset_class_geometry_type",
        ),
    )


def downgrade() -> None:
    op.drop_table("asset_class")
