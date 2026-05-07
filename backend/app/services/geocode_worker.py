"""Drain `geocode_queue`, populate `asset.address_cached`.

For v1 the geocoder is a stub that returns ``f"~{lat:.4f}, {lon:.4f}"`` —
real provider integration (Nominatim self-host or commercial) lands in a
separate PR per spec. The interface is the same either way:
`reverse_geocode(lat, lon) -> str | None`.

The worker is deliberately simple: process up to N rows per tick, retry
on transient failures by leaving the row in place + bumping `attempts`,
delete on success. `flask geocode-tick` is the cron entry point.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from flask import g
from geoalchemy2.shape import to_shape
from shapely.geometry import Point as ShapelyPoint
from sqlalchemy import select

from app.extensions import db
from app.models import Asset, GeocodeQueue

logger = logging.getLogger(__name__)


def reverse_geocode_stub(lat: float, lon: float) -> str:
    """Placeholder geocoder. Real providers swap in here."""
    return f"~{lat:.4f}, {lon:.4f}"


def _asset_centroid(asset: Asset) -> tuple[float, float] | None:
    if asset.geom is None:
        return None
    shape = to_shape(asset.geom)
    if isinstance(shape, ShapelyPoint):
        return (shape.y, shape.x)
    centroid = shape.centroid
    return (centroid.y, centroid.x)


def tick(*, batch_size: int = 100) -> dict[str, Any]:
    """Process up to `batch_size` rows. Cross-tenant — caller bypasses
    the listener."""
    g.skip_tenant_filter = True

    rows = db.session.scalars(select(GeocodeQueue).order_by(GeocodeQueue.enqueued_at.asc()).limit(batch_size)).all()

    geocoded = 0
    failed = 0
    for row in rows:
        asset = db.session.get(Asset, row.asset_id)
        if asset is None:
            # Asset was deleted between enqueue and tick — nothing to do.
            db.session.delete(row)
            continue
        coords = _asset_centroid(asset)
        if coords is None:
            row.attempts += 1
            row.last_error = "no geometry"
            failed += 1
            continue
        try:
            label = reverse_geocode_stub(*coords)
        except Exception as e:
            row.attempts += 1
            row.last_error = str(e)[:500]
            failed += 1
            logger.exception("geocode failed for asset %s", asset.id)
            continue

        asset.address_cached = label
        asset.address_cached_at = datetime.now(UTC)
        db.session.delete(row)
        geocoded += 1

    db.session.commit()
    return {"geocoded": geocoded, "failed": failed, "processed": len(rows)}
