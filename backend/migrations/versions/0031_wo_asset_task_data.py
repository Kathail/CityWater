"""work_order_asset: per-asset task_data JSONB

Revision ID: 0031_wo_asset_task_data
Revises: 0030_time_log_tenant_id
Create Date: 2026-05-07 11:30:00.000000

Route WOs (hydrant flushing, valve exercising, manhole inspection)
hit dozens of assets per shift. Each stop deserves its own structured
observations — flush minutes for *this* hydrant, residual reading at
*this* tap — but the WO carried a single shared task_data blob. This
migration adds task_data JSONB to work_order_asset so each stop
records its own values, which the frontend renders against the WO
task definition's smart_comments to produce a per-asset narrative
without the operator typing a free-text comment.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0031_wo_asset_task_data"
down_revision = "0030_time_log_tenant_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_order_asset",
        sa.Column(
            "task_data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("work_order_asset", "task_data")
