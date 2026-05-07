"""Service-area CRUD + spatial containment queries.

Service areas are polygon-bearing operational classifications:
maintenance districts, water distribution systems, sewer collection
systems, storm drainage systems. A tenant typically has several.
Multiple kinds can overlap — a single asset might sit inside the
"North maintenance" area AND the "Annexed water system" AND the
"Combined sewer system" all at once.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select

from app.errors import NotFoundError, ValidationError
from app.extensions import db
from app.models import Asset, ServiceArea
from app.schemas.service_area import (
    ServiceAreaCreate,
    ServiceAreaListItem,
    ServiceAreaListResponse,
    ServiceAreaRead,
    ServiceAreaUpdate,
)
from app.services.geometry import geojson_to_wkb, wkb_to_geojson
from app.services.permissions import require_roles

service_areas_bp = Blueprint("service_areas", __name__, url_prefix="/api/v1/service-areas")


def _validate(model, payload):
    try:
        return model.model_validate(payload)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _normalize_to_multipolygon(geom: dict[str, Any]) -> dict[str, Any]:
    """Accept Polygon or MultiPolygon GeoJSON; emit MultiPolygon."""
    t = geom.get("type")
    if t == "MultiPolygon":
        return geom
    if t == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [geom.get("coordinates", [])]}
    raise ValidationError(
        f"service area geometry must be Polygon or MultiPolygon (got {t!r})",
        code="bad_geometry",
    )


def _payload(area: ServiceArea, *, include_geom: bool = True) -> dict[str, Any]:
    return {
        "id": area.id,
        "code": area.code,
        "name": area.name,
        "kind": area.kind,
        "color": area.color,
        "parent_id": area.parent_id,
        "geometry": wkb_to_geojson(area.geom) if include_geom else None,
        "attrs": area.attrs or {},
        "created_at": area.created_at.isoformat(),
        "updated_at": area.updated_at.isoformat(),
    }


@service_areas_bp.get("")
@login_required
def list_service_areas():
    kind = request.args.get("kind")
    include_geom = request.args.get("include_geom", "true").lower() != "false"
    stmt = select(ServiceArea)
    if kind:
        stmt = stmt.where(ServiceArea.kind == kind)
    rows = db.session.scalars(stmt.order_by(ServiceArea.kind, ServiceArea.name)).all()
    items = [ServiceAreaListItem.model_validate(_payload(a, include_geom=include_geom)) for a in rows]
    return jsonify(ServiceAreaListResponse(items=items).model_dump(mode="json"))


@service_areas_bp.get("/<int:area_id>")
@login_required
def get_service_area(area_id: int):
    area = db.session.scalar(select(ServiceArea).where(ServiceArea.id == area_id))
    if area is None or area.deleted_at is not None:
        raise NotFoundError(f"service area {area_id} not found")
    return jsonify(ServiceAreaRead.model_validate(_payload(area)).model_dump(mode="json"))


@service_areas_bp.post("")
@login_required
@require_roles("admin", "supervisor")
def create_service_area():
    data = _validate(ServiceAreaCreate, request.get_json(silent=True) or {})
    geom = _normalize_to_multipolygon(data.geometry)
    area = ServiceArea(
        tenant_id=current_user.tenant_id,
        code=data.code,
        name=data.name,
        kind=data.kind,
        color=data.color,
        parent_id=data.parent_id,
        geom=geojson_to_wkb(geom),
        attrs=data.attrs,
    )
    db.session.add(area)
    db.session.commit()
    db.session.refresh(area)
    return jsonify(ServiceAreaRead.model_validate(_payload(area)).model_dump(mode="json")), 201


@service_areas_bp.patch("/<int:area_id>")
@login_required
@require_roles("admin", "supervisor")
def update_service_area(area_id: int):
    data = _validate(ServiceAreaUpdate, request.get_json(silent=True) or {})
    area = db.session.scalar(select(ServiceArea).where(ServiceArea.id == area_id))
    if area is None or area.deleted_at is not None:
        raise NotFoundError(f"service area {area_id} not found")
    for field in ("code", "name", "kind", "color", "parent_id", "attrs"):
        val = getattr(data, field)
        if val is not None:
            setattr(area, field, val)
    if data.geometry is not None:
        area.geom = geojson_to_wkb(_normalize_to_multipolygon(data.geometry))
    db.session.commit()
    db.session.refresh(area)
    return jsonify(ServiceAreaRead.model_validate(_payload(area)).model_dump(mode="json"))


@service_areas_bp.delete("/<int:area_id>")
@login_required
@require_roles("admin")
def delete_service_area(area_id: int):
    from datetime import UTC, datetime

    area = db.session.scalar(select(ServiceArea).where(ServiceArea.id == area_id))
    if area is None or area.deleted_at is not None:
        raise NotFoundError(f"service area {area_id} not found")
    area.deleted_at = datetime.now(UTC)
    db.session.commit()
    return ("", 204)


@service_areas_bp.get("/containing")
@login_required
def areas_containing_point():
    """Spatial query: which areas contain the supplied lon/lat?"""
    try:
        lon = float(request.args["lon"])
        lat = float(request.args["lat"])
    except (KeyError, ValueError) as e:
        raise ValidationError("lon and lat query params required (floats)") from e
    pt = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)
    rows = db.session.scalars(
        select(ServiceArea).where(func.ST_Contains(ServiceArea.geom, pt)).order_by(ServiceArea.kind, ServiceArea.name)
    ).all()
    return jsonify(
        {
            "items": [
                ServiceAreaListItem.model_validate(_payload(a, include_geom=False)).model_dump(mode="json")
                for a in rows
            ]
        }
    )


def _serialize_area(a: ServiceArea) -> dict[str, Any]:
    return {
        "id": a.id,
        "code": a.code,
        "name": a.name,
        "kind": a.kind,
        "color": a.color,
    }


def areas_for_asset(asset_id: int) -> list[dict[str, Any]]:
    """Containing service areas for an asset. ST_Intersects handles
    line/polygon assets that cross an area boundary correctly."""
    rows = (
        db.session.execute(
            select(ServiceArea)
            .join(Asset, func.ST_Intersects(ServiceArea.geom, Asset.geom))
            .where(Asset.id == asset_id)
            .order_by(ServiceArea.kind, ServiceArea.name)
        )
        .scalars()
        .all()
    )
    return [_serialize_area(a) for a in rows]


def areas_for_point(wkb_or_none: Any) -> list[dict[str, Any]]:
    """Containing service areas for a single POINT (or None)."""
    if wkb_or_none is None:
        return []
    rows = db.session.scalars(
        select(ServiceArea)
        .where(func.ST_Contains(ServiceArea.geom, wkb_or_none))
        .order_by(ServiceArea.kind, ServiceArea.name)
    ).all()
    return [_serialize_area(a) for a in rows]


def areas_for_wo_or_sr(*, location: Any, asset_id: int | None) -> list[dict[str, Any]]:
    """Pick the right containing-area lookup based on what the entity
    has: prefer the entity's own POINT location; fall back to the
    linked asset's geom (which may be a Point, LineString, or Polygon)."""
    if location is not None:
        return areas_for_point(location)
    if asset_id is not None:
        return areas_for_asset(asset_id)
    return []
