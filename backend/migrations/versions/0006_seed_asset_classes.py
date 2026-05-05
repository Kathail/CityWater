"""seed 23 asset classes

Revision ID: 0006_seed_asset_classes
Revises: 0005_asset_class
Create Date: 2026-05-05 12:05:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_seed_asset_classes"
down_revision = "0005_asset_class"
branch_labels = None
depends_on = None

# Per docs/SPEC.md §3.2. Domain colors are minimal defaults; tenants can override later.
ASSET_CLASSES = [
    # Water distribution
    ("WAT_MAIN", "water", "Water main", "LineString", "#1e88e5"),
    ("WAT_HYD", "water", "Hydrant", "Point", "#1e88e5"),
    ("WAT_VLV", "water", "Water valve", "Point", "#1e88e5"),
    ("WAT_SVC", "water", "Service line", "LineString", "#1e88e5"),
    ("WAT_MTR", "water", "Meter", "Point", "#1e88e5"),
    ("WAT_PMP", "water", "Pump", "Point", "#1e88e5"),
    ("WAT_RES", "water", "Reservoir/tank", "Polygon", "#1e88e5"),
    ("WAT_PRV", "water", "PRV station", "Point", "#1e88e5"),
    # Wastewater collection
    ("SAN_MAIN", "sewer", "Gravity sanitary sewer main", "LineString", "#6d4c41"),
    ("SAN_FM", "sewer", "Sanitary force main", "LineString", "#6d4c41"),
    ("SAN_MH", "sewer", "Sanitary manhole", "Point", "#6d4c41"),
    ("SAN_LFT", "sewer", "Lift station", "Point", "#6d4c41"),
    ("SAN_CO", "sewer", "Cleanout", "Point", "#6d4c41"),
    ("SAN_LAT", "sewer", "Sanitary lateral", "LineString", "#6d4c41"),
    ("SAN_GT", "sewer", "Grease trap", "Point", "#6d4c41"),
    # Storm drainage
    ("STM_MAIN", "storm", "Storm main", "LineString", "#43a047"),
    ("STM_CB", "storm", "Catch basin", "Point", "#43a047"),
    ("STM_MH", "storm", "Storm manhole", "Point", "#43a047"),
    ("STM_OUT", "storm", "Outfall", "Point", "#43a047"),
    ("STM_CULV", "storm", "Culvert", "LineString", "#43a047"),
    ("STM_DTCH", "storm", "Ditch", "LineString", "#43a047"),
    ("STM_BMP", "storm", "BMP (oil/grit, pond, swale)", "Polygon", "#43a047"),
    ("STM_INL", "storm", "Inlet", "Point", "#43a047"),
]


def upgrade() -> None:
    asset_class_table = sa.table(
        "asset_class",
        sa.column("code", sa.String),
        sa.column("domain", sa.String),
        sa.column("name", sa.String),
        sa.column("geometry_type", sa.String),
        sa.column("color", sa.String),
    )
    op.bulk_insert(
        asset_class_table,
        [
            {
                "code": code,
                "domain": domain,
                "name": name,
                "geometry_type": geom_type,
                "color": color,
            }
            for code, domain, name, geom_type, color in ASSET_CLASSES
        ],
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM asset_class WHERE code = ANY(:codes)").bindparams(
            sa.bindparam("codes", [c[0] for c in ASSET_CLASSES])
        )
    )
