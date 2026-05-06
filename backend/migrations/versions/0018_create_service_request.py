"""create service_request

Revision ID: 0018_service_request
Revises: 0017_pacp_code
Create Date: 2026-05-06 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision = "0018_service_request"
down_revision = "0017_pacp_code"
branch_labels = None
depends_on = None

VALID_CATEGORIES = (
    "low_pressure",
    "no_water",
    "sewer_backup",
    "flooding",
    "odour",
    "damaged_asset",
    "other",
)
VALID_DOMAINS = ("water", "sewer", "storm")
VALID_STATUSES = ("new", "triaged", "dispatched", "closed", "duplicate")
VALID_PRIORITIES = ("low", "normal", "high", "emergency")


def _enum(values: tuple[str, ...], column: str) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "service_request",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("sr_number", sa.String(length=32), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("domain", sa.String(length=16), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="new",
        ),
        sa.Column(
            "priority",
            sa.String(length=16),
            nullable=False,
            server_default="normal",
        ),
        sa.Column(
            "reported_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("caller_name", sa.String(length=200), nullable=True),
        sa.Column("caller_phone", sa.String(length=64), nullable=True),
        sa.Column("caller_email", sa.String(length=320), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column(
            "location",
            Geometry(geometry_type="POINT", srid=4326),
            nullable=True,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("intake_user_id", sa.BigInteger(), nullable=True),
        sa.Column("work_order_id", sa.BigInteger(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closure_notes", sa.Text(), nullable=True),
        sa.Column(
            "closure_reason",
            sa.String(length=32),
            nullable=True,
        ),
        sa.Column(
            "duplicate_of_id",
            sa.BigInteger(),
            nullable=True,
        ),
        sa.Column(
            "attrs",
            postgresql.JSONB(),
            nullable=False,
            server_default="{}",
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
            ["tenant_id"],
            ["tenant.id"],
            name="fk_service_request_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["intake_user_id"],
            ["user.id"],
            name="fk_service_request_intake_user_id_user",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["work_order_id"],
            ["work_order.id"],
            name="fk_service_request_work_order_id_work_order",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_of_id"],
            ["service_request.id"],
            name="fk_service_request_duplicate_of_id_service_request",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_service_request"),
        sa.UniqueConstraint(
            "tenant_id",
            "sr_number",
            name="uq_service_request_tenant_id_sr_number",
        ),
        sa.CheckConstraint(_enum(VALID_CATEGORIES, "category"), name="ck_service_request_category"),
        sa.CheckConstraint(_enum(VALID_DOMAINS, "domain"), name="ck_service_request_domain"),
        sa.CheckConstraint(_enum(VALID_STATUSES, "status"), name="ck_service_request_status"),
        sa.CheckConstraint(_enum(VALID_PRIORITIES, "priority"), name="ck_service_request_priority"),
    )

    op.create_index(
        "ix_service_request_tenant_status",
        "service_request",
        ["tenant_id", "status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_service_request_tenant_reported_at",
        "service_request",
        ["tenant_id", sa.text("reported_at DESC")],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_service_request_location",
        "service_request",
        ["location"],
        postgresql_using="gist",
        postgresql_where=sa.text("deleted_at IS NULL AND location IS NOT NULL"),
    )

    op.add_column(
        "work_order",
        sa.Column("service_request_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_work_order_service_request_id_service_request",
        "work_order",
        "service_request",
        ["service_request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_work_order_service_request_id",
        "work_order",
        ["tenant_id", "service_request_id"],
        postgresql_where=sa.text("service_request_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_service_request_id", table_name="work_order")
    op.drop_constraint(
        "fk_work_order_service_request_id_service_request",
        "work_order",
        type_="foreignkey",
    )
    op.drop_column("work_order", "service_request_id")
    op.drop_index("ix_service_request_location", table_name="service_request")
    op.drop_index("ix_service_request_tenant_reported_at", table_name="service_request")
    op.drop_index("ix_service_request_tenant_status", table_name="service_request")
    op.drop_table("service_request")
