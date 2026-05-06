"""drop locator CHECK constraints from 0022

Revision ID: 0024_drop_checks
Revises: 0023_wo_route
Create Date: 2026-05-06 04:30:00.000000

The DB-level CHECKs from 0022 (chk_wo_location_or_asset,
chk_sr_has_locator, chk_inspection_has_target) are too aggressive —
they break legitimate operator flows where a WO is opened with a title
only and an asset is linked later. Move the validation to the
application layer (service-layer creators in Slice B) where the error
message can be friendly and contextual.
"""

from __future__ import annotations

from alembic import op

revision = "0024_drop_checks"
down_revision = "0023_wo_route"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE work_order DROP CONSTRAINT IF EXISTS chk_wo_location_or_asset;")
    op.execute("ALTER TABLE service_request DROP CONSTRAINT IF EXISTS chk_sr_has_locator;")
    op.execute("ALTER TABLE inspection DROP CONSTRAINT IF EXISTS chk_inspection_has_target;")


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE work_order
            ADD CONSTRAINT chk_wo_location_or_asset
            CHECK (asset_id IS NOT NULL OR location IS NOT NULL) NOT VALID;
        """
    )
    op.execute(
        """
        ALTER TABLE service_request
            ADD CONSTRAINT chk_sr_has_locator
            CHECK (
                asset_id IS NOT NULL
                OR location IS NOT NULL
                OR reported_address IS NOT NULL
            ) NOT VALID;
        """
    )
    op.execute(
        """
        ALTER TABLE inspection
            ADD CONSTRAINT chk_inspection_has_target
            CHECK (asset_id IS NOT NULL OR work_order_id IS NOT NULL) NOT VALID;
        """
    )
