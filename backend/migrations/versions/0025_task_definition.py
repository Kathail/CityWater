"""task_definition + task_definition_id/task_data on WO/SR/Inspection

Revision ID: 0025_task_def
Revises: 0024_drop_checks
Create Date: 2026-05-06 05:00:00.000000

The keystone feature. Task definitions are the rows that drive form
rendering, procedure rendering, prefill, completion contracts, and
follow-up spawning. After this lands, adding a new operator workflow is
content (a row), not code.

The PR is foundation-only — schema, evaluator, services, API, ONE seed
to prove the slice. Content batches land in subsequent PRs.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0025_task_def"
down_revision = "0024_drop_checks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_definition",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column(
            "produces",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("default_category", sa.String(length=64), nullable=True),
        sa.Column("default_priority", sa.String(length=16), nullable=True),
        sa.Column("default_domain", sa.String(length=16), nullable=True),
        sa.Column(
            "applies_to_classes",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("triggers", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("prefill", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("form", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "canned_comments",
            postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("procedure", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("completion", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("spawns", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("clocks", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("lang", sa.String(length=8), nullable=False, server_default="en"),
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
            name="fk_task_definition_tenant_id_tenant",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_task_definition"),
        sa.UniqueConstraint(
            "tenant_id", "code", "version", name="uq_task_definition_tenant_code_version"
        ),
        sa.CheckConstraint(
            "produces IN ('work_order', 'inspection', 'service_request')",
            name="ck_task_definition_produces",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'archived')",
            name="ck_task_definition_status",
        ),
        sa.CheckConstraint(
            "default_domain IS NULL OR default_domain IN ('water','sewer','storm','any')",
            name="ck_task_definition_default_domain",
        ),
    )
    op.create_index(
        "ix_task_def_active",
        "task_definition",
        ["tenant_id", "status"],
        postgresql_where=sa.text("deleted_at IS NULL AND status = 'active'"),
    )
    op.create_index(
        "ix_task_def_classes",
        "task_definition",
        ["applies_to_classes"],
        postgresql_using="gin",
    )
    op.create_index(
        "ix_task_def_triggers",
        "task_definition",
        ["triggers"],
        postgresql_using="gin",
        postgresql_ops={"triggers": "jsonb_path_ops"},
    )
    # Only one active version per (tenant, code).
    op.create_index(
        "ux_task_def_one_active_per_code",
        "task_definition",
        ["tenant_id", "code"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND deleted_at IS NULL"),
    )

    # Add task_definition_id + task_data to the three entity tables.
    for entity in ("work_order", "inspection", "service_request"):
        op.add_column(
            entity,
            sa.Column("task_definition_id", sa.BigInteger(), nullable=True),
        )
        op.add_column(
            entity,
            sa.Column(
                "task_data", postgresql.JSONB(), nullable=False, server_default="{}"
            ),
        )
        op.create_foreign_key(
            f"fk_{entity}_task_definition_id_task_definition",
            entity,
            "task_definition",
            ["task_definition_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            f"ix_{entity}_task_definition_id",
            entity,
            ["tenant_id", "task_definition_id"],
            postgresql_where=sa.text("task_definition_id IS NOT NULL"),
        )


def downgrade() -> None:
    for entity in ("service_request", "inspection", "work_order"):
        op.drop_index(f"ix_{entity}_task_definition_id", table_name=entity)
        op.drop_constraint(
            f"fk_{entity}_task_definition_id_task_definition",
            entity,
            type_="foreignkey",
        )
        op.drop_column(entity, "task_data")
        op.drop_column(entity, "task_definition_id")

    op.drop_index("ux_task_def_one_active_per_code", table_name="task_definition")
    op.drop_index("ix_task_def_triggers", table_name="task_definition")
    op.drop_index("ix_task_def_classes", table_name="task_definition")
    op.drop_index("ix_task_def_active", table_name="task_definition")
    op.drop_table("task_definition")
