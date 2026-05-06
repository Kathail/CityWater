"""work_order_asset: route ordering + per-stop completion

Revision ID: 0023_wo_route
Revises: 0022_autopopulation
Create Date: 2026-05-06 04:00:00.000000

Lets one WO carry an ordered list of assets — hydrant flushing routes,
valve-exercising loops, sewer-cleaning runs. Adds:

- `sequence INT NULL` — null when the WO has a single asset (no order
  needed); 1-N when supervisor pre-builds a route. Operators tap stops
  off in this order.
- `completed_at TIMESTAMPTZ NULL` — per-stop check-off.
- `completion_notes TEXT NULL` — per-stop note (eg "hydrant stuck, needed
  cheater bar").

The single-asset shortcut on `work_order.asset_id` still mirrors the
`role='primary'` row, which works for both single-asset WOs and as the
first stop of a route. The frontend switches to a "route view" layout
when the WO has >3 linked assets.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_wo_route"
down_revision = "0022_autopopulation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_order_asset",
        sa.Column("sequence", sa.Integer(), nullable=True),
    )
    op.add_column(
        "work_order_asset",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "work_order_asset",
        sa.Column("completion_notes", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_work_order_asset_sequence",
        "work_order_asset",
        ["work_order_id", "sequence"],
        postgresql_where=sa.text("sequence IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_asset_sequence", table_name="work_order_asset")
    op.drop_column("work_order_asset", "completion_notes")
    op.drop_column("work_order_asset", "completed_at")
    op.drop_column("work_order_asset", "sequence")
