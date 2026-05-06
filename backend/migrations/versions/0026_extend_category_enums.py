"""extend WO + SR category enums for the discoloured-water task

Revision ID: 0026_categories
Revises: 0025_task_def
Create Date: 2026-05-06 06:00:00.000000

The keystone task definition (`WAT-TASK-DISCOLOURED`) wants:
- `WorkOrder.category = 'investigation'` as its default
- `ServiceRequest.category in ('discoloured_water', 'water_quality')`
  as the triggers

Both values were missing from the existing CHECK enums. Adding them
non-destructively — just rebuilding the constraints with the wider
allowed set. No data changes; only category writes pick up the new
values once consumers (seed task, frontend forms) start using them.
"""

from __future__ import annotations

from alembic import op

revision = "0026_categories"
down_revision = "0025_task_def"
branch_labels = None
depends_on = None

WO_CATEGORIES_NEW = (
    "main_break",
    "flushing",
    "valve_exercise",
    "cleaning",
    "inspection",
    "investigation",  # added
    "repair",
    "install",
    "other",
)

SR_CATEGORIES_NEW = (
    "low_pressure",
    "no_water",
    "sewer_backup",
    "flooding",
    "odour",
    "damaged_asset",
    "discoloured_water",  # added
    "water_quality",  # added
    "other",
)

WO_CATEGORIES_OLD = (
    "main_break",
    "flushing",
    "valve_exercise",
    "cleaning",
    "inspection",
    "repair",
    "install",
    "other",
)

SR_CATEGORIES_OLD = (
    "low_pressure",
    "no_water",
    "sewer_backup",
    "flooding",
    "odour",
    "damaged_asset",
    "other",
)


def _enum_in(values: tuple[str, ...]) -> str:
    return f"category IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    # Drop via raw SQL — alembic's naming convention double-prefixes
    # passed names ("ck_X" → "ck_table_ck_X"), but the *existing* constraint
    # was already created with the doubled prefix back in 0010. Using raw
    # SQL avoids the re-prefixing footgun.
    op.execute(
        "ALTER TABLE work_order "
        "DROP CONSTRAINT ck_work_order_ck_work_order_category"
    )
    op.execute(
        f"ALTER TABLE work_order "
        f"ADD CONSTRAINT ck_work_order_category CHECK ({_enum_in(WO_CATEGORIES_NEW)})"
    )

    op.execute(
        "ALTER TABLE service_request "
        "DROP CONSTRAINT ck_service_request_ck_service_request_category"
    )
    op.execute(
        f"ALTER TABLE service_request "
        f"ADD CONSTRAINT ck_service_request_category "
        f"CHECK ({_enum_in(SR_CATEGORIES_NEW)})"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE service_request DROP CONSTRAINT ck_service_request_category")
    op.execute(
        f"ALTER TABLE service_request "
        f"ADD CONSTRAINT ck_service_request_ck_service_request_category "
        f"CHECK ({_enum_in(SR_CATEGORIES_OLD)})"
    )
    op.execute("ALTER TABLE work_order DROP CONSTRAINT ck_work_order_category")
    op.execute(
        f"ALTER TABLE work_order "
        f"ADD CONSTRAINT ck_work_order_ck_work_order_category "
        f"CHECK ({_enum_in(WO_CATEGORIES_OLD)})"
    )
