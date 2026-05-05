"""create asset

Revision ID: 0007_asset
Revises: 0006_seed_asset_classes
Create Date: 2026-05-05 12:06:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision = "0007_asset"
down_revision = "0006_seed_asset_classes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("asset_uid", sa.String(), nullable=False),
        sa.Column("class_code", sa.String(length=32), nullable=False),
        sa.Column(
            "geom",
            Geometry(geometry_type="GEOMETRY", srid=4326),
            nullable=False,
        ),
        sa.Column("install_date", sa.Date(), nullable=True),
        sa.Column("decommission_date", sa.Date(), nullable=True),
        sa.Column("material", sa.String(), nullable=True),
        sa.Column("diameter_mm", sa.Integer(), nullable=True),
        sa.Column("length_m", sa.Numeric(10, 2), nullable=True),
        sa.Column("depth_m", sa.Numeric(6, 2), nullable=True),
        sa.Column("manufacturer", sa.String(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("serial_number", sa.String(), nullable=True),
        sa.Column("warranty_until", sa.Date(), nullable=True),
        sa.Column("condition", sa.Integer(), nullable=True),
        sa.Column("criticality", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="active",
            nullable=False,
        ),
        sa.Column(
            "attrs",
            postgresql.JSONB(),
            server_default="{}",
            nullable=False,
        ),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name="fk_asset_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["class_code"],
            ["asset_class.code"],
            name="fk_asset_class_code_asset_class",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_asset"),
        sa.UniqueConstraint(
            "tenant_id", "asset_uid", name="uq_asset_tenant_id_asset_uid"
        ),
        sa.CheckConstraint(
            "condition IS NULL OR condition BETWEEN 1 AND 5",
            name="ck_asset_condition",
        ),
        sa.CheckConstraint(
            "criticality IS NULL OR criticality BETWEEN 1 AND 5",
            name="ck_asset_criticality",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'abandoned', 'removed', 'proposed')",
            name="ck_asset_status",
        ),
    )
    op.create_index(
        "ix_asset_tenant_id_class_code", "asset", ["tenant_id", "class_code"]
    )
    op.create_index(
        "ix_asset_active",
        "asset",
        ["tenant_id", "status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_asset_geom", "asset", ["geom"], postgresql_using="gist"
    )
    op.create_index(
        "ix_asset_attrs",
        "asset",
        ["attrs"],
        postgresql_using="gin",
        postgresql_ops={"attrs": "jsonb_path_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_asset_attrs", table_name="asset")
    op.drop_index("ix_asset_geom", table_name="asset")
    op.drop_index("ix_asset_active", table_name="asset")
    op.drop_index("ix_asset_tenant_id_class_code", table_name="asset")
    op.drop_table("asset")
