"""link-driven autopopulation: address cache, override columns, work_order_asset, geocode queue

Revision ID: 0022_autopopulation
Revises: 0021_comment
Create Date: 2026-05-06 03:30:00.000000

The link is the source of truth — shared fields resolve through linked
assets at read time rather than being duplicated. This migration adds the
plumbing:

- `asset.address_cached` + `address_cached_at` for fast resolution.
- `asset` INSERT/UPDATE-of-geom trigger that enqueues a geocode job.
- `geocode_queue` table consumed by `flask geocode-tick`.
- `service_request.asset_id` (was missing — SRs are now first-class
  asset-linked) and `service_request.address_override` (companion to
  the renamed `reported_address`).
- `work_order.address_override` for "operator typed a different address
  from the linked asset" — rare but real.
- `work_order_asset` M:N table with role + a partial unique on `primary`.
- CHECK constraints requiring at least one locator on each entity.
- Backfill: existing demo WOs / inspections with neither asset nor
  location are flagged via NOT VALID so the constraint can be added
  without breaking historical data; the operator validates after fixing
  legacy rows.

The legacy `service_request.address` is renamed to `reported_address` so
the public API can distinguish "what the caller said" from "the resolved
address (asset_cached or override)".
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_autopopulation"
down_revision = "0021_comment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- asset: address cache ----------
    op.add_column(
        "asset",
        sa.Column("address_cached", sa.Text(), nullable=True),
    )
    op.add_column(
        "asset",
        sa.Column("address_cached_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_asset_address_cached_at",
        "asset",
        ["address_cached_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # ---------- geocode queue + trigger ----------
    op.create_table(
        "geocode_queue",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("asset_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "enqueued_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["asset.id"],
            name="fk_geocode_queue_asset_id_asset",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_geocode_queue"),
        sa.UniqueConstraint("asset_id", name="uq_geocode_queue_asset_id"),
    )

    # Trigger function + trigger. UPDATE OF geom only — we don't want the
    # asset's address to recompute every time someone edits notes.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION enqueue_asset_geocode()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO geocode_queue (asset_id)
            VALUES (NEW.id)
            ON CONFLICT (asset_id) DO UPDATE
                SET enqueued_at = now(), attempts = 0, last_error = NULL;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_asset_geocode_enqueue
            AFTER INSERT OR UPDATE OF geom ON asset
            FOR EACH ROW EXECUTE FUNCTION enqueue_asset_geocode();
        """
    )

    # ---------- work_order: override + multi-asset link ----------
    op.add_column(
        "work_order",
        sa.Column("address_override", sa.Text(), nullable=True),
    )

    op.create_table(
        "work_order_asset",
        sa.Column("work_order_id", sa.BigInteger(), nullable=False),
        sa.Column("asset_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "role",
            sa.String(length=32),
            nullable=False,
            server_default="affected",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["work_order_id"],
            ["work_order.id"],
            name="fk_work_order_asset_work_order_id_work_order",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["asset.id"],
            name="fk_work_order_asset_asset_id_asset",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "work_order_id", "asset_id", name="pk_work_order_asset"
        ),
        sa.CheckConstraint(
            "role IN ('primary', 'affected', 'isolated_by', 'witness')",
            name="ck_work_order_asset_role",
        ),
    )
    op.create_index(
        "ux_wo_one_primary_asset",
        "work_order_asset",
        ["work_order_id"],
        unique=True,
        postgresql_where=sa.text("role = 'primary'"),
    )
    op.create_index(
        "ix_wo_asset_by_asset",
        "work_order_asset",
        ["asset_id"],
    )

    # CHECK: WO must have at least one locator. Use NOT VALID so
    # historical rows missing both don't block the migration; operators
    # validate (`ALTER TABLE work_order VALIDATE CONSTRAINT chk_...`) once
    # they've backfilled.
    op.execute(
        """
        ALTER TABLE work_order
            ADD CONSTRAINT chk_wo_location_or_asset
            CHECK (asset_id IS NOT NULL OR location IS NOT NULL) NOT VALID;
        """
    )

    # ---------- service_request: rename + asset link ----------
    op.alter_column("service_request", "address", new_column_name="reported_address")
    op.add_column(
        "service_request",
        sa.Column("asset_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "service_request",
        sa.Column("address_override", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_service_request_asset_id_asset",
        "service_request",
        "asset",
        ["asset_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_service_request_asset_id",
        "service_request",
        ["tenant_id", "asset_id"],
        postgresql_where=sa.text("asset_id IS NOT NULL AND deleted_at IS NULL"),
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

    # ---------- inspection: target locator constraint ----------
    op.execute(
        """
        ALTER TABLE inspection
            ADD CONSTRAINT chk_inspection_has_target
            CHECK (asset_id IS NOT NULL OR work_order_id IS NOT NULL) NOT VALID;
        """
    )

    # ---------- prime the geocode queue with every existing asset ----------
    # Existing rows didn't trigger the new function. Backfill so the worker
    # has a list to chew through on first run.
    op.execute(
        """
        INSERT INTO geocode_queue (asset_id)
        SELECT id FROM asset WHERE deleted_at IS NULL
        ON CONFLICT (asset_id) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE inspection DROP CONSTRAINT IF EXISTS chk_inspection_has_target;")
    op.execute("ALTER TABLE service_request DROP CONSTRAINT IF EXISTS chk_sr_has_locator;")
    op.execute("ALTER TABLE work_order DROP CONSTRAINT IF EXISTS chk_wo_location_or_asset;")

    op.drop_index("ix_service_request_asset_id", table_name="service_request")
    op.drop_constraint(
        "fk_service_request_asset_id_asset", "service_request", type_="foreignkey"
    )
    op.drop_column("service_request", "address_override")
    op.drop_column("service_request", "asset_id")
    op.alter_column("service_request", "reported_address", new_column_name="address")

    op.drop_index("ix_wo_asset_by_asset", table_name="work_order_asset")
    op.drop_index("ux_wo_one_primary_asset", table_name="work_order_asset")
    op.drop_table("work_order_asset")
    op.drop_column("work_order", "address_override")

    op.execute("DROP TRIGGER IF EXISTS trg_asset_geocode_enqueue ON asset;")
    op.execute("DROP FUNCTION IF EXISTS enqueue_asset_geocode();")
    op.drop_table("geocode_queue")

    op.drop_index("ix_asset_address_cached_at", table_name="asset")
    op.drop_column("asset", "address_cached_at")
    op.drop_column("asset", "address_cached")
