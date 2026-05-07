"""Map overlay GeoJSON for the operations map.

One round-trip returns the active operational layers — open WOs and
active SRs — as GeoJSON FeatureCollections ready to drop into a MapLibre
GeoJSON source. WOs and SRs without a `location` of their own fall back
to the centroid of their linked asset so the pin still shows up.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify
from flask_login import login_required
from sqlalchemy import case, cast, func, select
from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db
from app.models import Asset, ServiceArea, ServiceRequest, WorkOrder

map_overlays_bp = Blueprint("map_overlays", __name__, url_prefix="/api/v1/map")


WO_ACTIVE_STATUSES = ("open", "assigned", "in_progress", "on_hold")
SR_ACTIVE_STATUSES = ("new", "triaged", "dispatched")


@map_overlays_bp.get("/overlays")
@login_required
def get_overlays():
    return jsonify(
        {
            "open_wos": _wo_features(),
            "active_srs": _sr_features(),
            "service_areas": _service_area_features(),
        }
    )


def _service_area_features() -> dict[str, Any]:
    # Cast ST_AsGeoJSON's text result to JSONB so psycopg returns a
    # parsed dict and we skip a per-row json.loads in Python. For
    # tenants with thousands of overlay features this is the dominant
    # cost on the endpoint. MAP-P1-9.
    rows = db.session.execute(
        select(
            ServiceArea.id,
            ServiceArea.code,
            ServiceArea.name,
            ServiceArea.kind,
            ServiceArea.color,
            cast(func.ST_AsGeoJSON(ServiceArea.geom), JSONB).label("geom_json"),
        ).where(ServiceArea.deleted_at.is_(None))
    ).all()

    features: list[dict[str, Any]] = []
    for r in rows:
        if not r.geom_json:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": r.geom_json,
                "properties": {
                    "kind": "service_area",
                    "id": r.id,
                    "code": r.code,
                    "name": r.name,
                    "area_kind": r.kind,
                    "color": r.color,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _wo_features() -> dict[str, Any]:
    # Use ST_AsGeoJSON on a coalesced point: WO.location > asset.location centroid.
    asset_pt = func.ST_AsGeoJSON(func.ST_PointOnSurface(Asset.geom))
    wo_pt = func.ST_AsGeoJSON(WorkOrder.location)
    rows = db.session.execute(
        select(
            WorkOrder.wo_number,
            WorkOrder.title,
            WorkOrder.category,
            WorkOrder.priority,
            WorkOrder.status,
            WorkOrder.scheduled_for,
            WorkOrder.due_by,
            Asset.asset_uid,
            cast(func.coalesce(wo_pt, asset_pt), JSONB).label("geom_json"),
        )
        .outerjoin(Asset, Asset.id == WorkOrder.asset_id)
        .where(WorkOrder.status.in_(WO_ACTIVE_STATUSES))
        .where(
            # We need either a WO location or a linkable asset geom to
            # show a pin. Anything else gets dropped (would render as 0,0).
            case((WorkOrder.location.is_not(None), True), else_=Asset.id.is_not(None))
        )
    ).all()

    features: list[dict[str, Any]] = []
    for r in rows:
        if not r.geom_json:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": r.geom_json,
                "properties": {
                    "kind": "work_order",
                    "wo_number": r.wo_number,
                    "title": r.title,
                    "category": r.category,
                    "priority": r.priority,
                    "status": r.status,
                    "scheduled_for": r.scheduled_for.isoformat() if r.scheduled_for else None,
                    "due_by": r.due_by.isoformat() if r.due_by else None,
                    "asset_uid": r.asset_uid,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _sr_features() -> dict[str, Any]:
    asset_pt = func.ST_AsGeoJSON(func.ST_PointOnSurface(Asset.geom))
    sr_pt = func.ST_AsGeoJSON(ServiceRequest.location)
    rows = db.session.execute(
        select(
            ServiceRequest.sr_number,
            ServiceRequest.category,
            ServiceRequest.domain,
            ServiceRequest.priority,
            ServiceRequest.status,
            ServiceRequest.reported_at,
            ServiceRequest.reported_address,
            Asset.asset_uid,
            cast(func.coalesce(sr_pt, asset_pt), JSONB).label("geom_json"),
        )
        .outerjoin(Asset, Asset.id == ServiceRequest.asset_id)
        .where(ServiceRequest.status.in_(SR_ACTIVE_STATUSES))
        .where(case((ServiceRequest.location.is_not(None), True), else_=Asset.id.is_not(None)))
    ).all()

    features: list[dict[str, Any]] = []
    for r in rows:
        if not r.geom_json:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": r.geom_json,
                "properties": {
                    "kind": "service_request",
                    "sr_number": r.sr_number,
                    "category": r.category,
                    "domain": r.domain,
                    "priority": r.priority,
                    "status": r.status,
                    "reported_at": r.reported_at.isoformat() if r.reported_at else None,
                    "reported_address": r.reported_address,
                    "asset_uid": r.asset_uid,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
