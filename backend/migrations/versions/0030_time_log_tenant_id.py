"""work_order_time_log: add tenant_id (close cross-tenant leak in dashboard)

Revision ID: 0030_time_log_tenant_id
Revises: 0029_audit_hardening
Create Date: 2026-05-07 09:00:00.000000

WO-P0-7. The dashboard's `hours_this_week` KPI summed `hours_decimal`
straight off `work_order_time_log` without joining through
`work_order` and without a tenant filter. The session-level tenant
filter listener could not help because the table had no `tenant_id`
column. This migration:

1. Adds `tenant_id BIGINT` (nullable) to work_order_time_log.
2. Backfills it from the parent `work_order` row.
3. Makes the column NOT NULL.
4. Names + indexes the FK.

Mirrors `0029_audit_hardening`'s treatment of work_order_asset.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0030_time_log_tenant_id"
down_revision = "0029_audit_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_order_time_log",
        sa.Column("tenant_id", sa.BigInteger(), nullable=True),
    )
    op.execute(
        """
        UPDATE work_order_time_log t
           SET tenant_id = wo.tenant_id
          FROM work_order wo
         WHERE t.work_order_id = wo.id
        """
    )
    op.alter_column("work_order_time_log", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_work_order_time_log_tenant_id_tenant",
        "work_order_time_log",
        "tenant",
        ["tenant_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_work_order_time_log_tenant_id",
        "work_order_time_log",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_time_log_tenant_id", table_name="work_order_time_log")
    op.drop_constraint(
        "fk_work_order_time_log_tenant_id_tenant",
        "work_order_time_log",
        type_="foreignkey",
    )
    op.drop_column("work_order_time_log", "tenant_id")
