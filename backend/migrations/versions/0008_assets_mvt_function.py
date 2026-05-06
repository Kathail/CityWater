"""create assets_mvt function

Revision ID: 0008_assets_mvt
Revises: 0007_asset
Create Date: 2026-05-05 12:07:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "0008_assets_mvt"
down_revision = "0007_asset"
branch_labels = None
depends_on = None


# Postgres function used by the backend tile endpoint. Tenant scoping is
# enforced by the function's _tenant_id arg, which the Flask handler reads
# from the authenticated session — clients never get to set it. Soft-deleted
# assets are excluded.
_UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION assets_mvt(
    _tenant_id BIGINT,
    z INTEGER,
    x INTEGER,
    y INTEGER
) RETURNS bytea AS $$
DECLARE
    mvt bytea;
BEGIN
    SELECT INTO mvt ST_AsMVT(tile, 'assets', 4096, 'geom')
    FROM (
        SELECT
            ST_AsMVTGeom(
                ST_Transform(a.geom, 3857),
                ST_TileEnvelope(z, x, y),
                4096,
                64,
                true
            ) AS geom,
            a.asset_uid,
            a.class_code,
            ac.domain,
            a.status,
            a.condition,
            a.criticality
        FROM asset a
        JOIN asset_class ac ON ac.code = a.class_code
        WHERE a.tenant_id = _tenant_id
          AND a.deleted_at IS NULL
          AND ST_Transform(a.geom, 3857) && ST_TileEnvelope(z, x, y)
    ) AS tile;
    RETURN COALESCE(mvt, ''::bytea);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
"""

_DOWNGRADE_SQL = "DROP FUNCTION IF EXISTS assets_mvt(BIGINT, INTEGER, INTEGER, INTEGER);"


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
