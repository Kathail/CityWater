from __future__ import annotations

from datetime import UTC, datetime, timedelta

from geoalchemy2 import WKBElement
from sqlalchemy import func, select

from app.extensions import db
from app.models import ServiceRequest

_DUPLICATE_RADIUS_M = 100.0
_DUPLICATE_WINDOW_DAYS = 7


def find_duplicates(
    *,
    tenant_id: int,
    location: WKBElement | None,
    reported_at: datetime,
    exclude_id: int | None = None,
    radius_m: float = _DUPLICATE_RADIUS_M,
    window_days: int = _DUPLICATE_WINDOW_DAYS,
) -> list[tuple[ServiceRequest, float]]:
    """Find SRs within `radius_m` and `window_days` of the given point/time.

    Spatial filter uses `ST_DWithin` against `geography(location)` so the
    radius is interpreted in metres (not degrees). Time filter is symmetric:
    `reported_at` ± `window_days` so an intake reported "back-dated" still
    matches recent events.

    Returns a list of (ServiceRequest, distance_metres) ordered by proximity.
    Empty list when location is None.
    """
    if location is None:
        return []

    since = reported_at - timedelta(days=window_days)
    until = reported_at + timedelta(days=window_days)

    # Cast both points to geography so ST_Distance / ST_DWithin work in metres.
    geog_self = func.ST_GeogFromWKB(func.ST_AsBinary(ServiceRequest.location))
    geog_other = func.ST_GeogFromWKB(func.ST_AsBinary(location))
    distance = func.ST_Distance(geog_self, geog_other)

    stmt = (
        select(ServiceRequest, distance.label("distance_m"))
        .where(
            ServiceRequest.tenant_id == tenant_id,
            ServiceRequest.location.is_not(None),
            ServiceRequest.reported_at.between(since, until),
            ServiceRequest.status != "duplicate",
            func.ST_DWithin(geog_self, geog_other, radius_m),
        )
        .order_by(distance.asc())
        .limit(10)
    )
    if exclude_id is not None:
        stmt = stmt.where(ServiceRequest.id != exclude_id)

    rows = db.session.execute(stmt).all()
    return [(row[0], float(row[1])) for row in rows]


def now_utc() -> datetime:
    return datetime.now(UTC)
