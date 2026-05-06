"""Resolve display fields through links rather than duplicating columns.

Read-only — never writes to the DB. The link is the source of truth: a
WO/SR/Inspection's address + coordinates flow from the linked asset's
cached address (refreshed by the geocode-tick worker) and centroid. The
operator-typed `address_override` wins when present.

A `ResolvedLocation` is what the API's `/resolved` endpoints surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from geoalchemy2.shape import to_shape
from shapely.geometry import Point as ShapelyPoint

from app.models import Asset, Inspection, ServiceRequest, WorkOrder

AddressSource = Literal[
    "override",
    "asset_cached",
    "asset_geocoded",
    "reported",
    "manual_point",
    "none",
]
CoordsSource = Literal["asset", "manual", "none"]


@dataclass(frozen=True)
class ResolvedLocation:
    address: str | None
    address_source: AddressSource
    coords: tuple[float, float] | None  # (lat, lon)
    coords_source: CoordsSource


def _asset_centroid(asset: Asset) -> tuple[float, float] | None:
    """Asset centroid as (lat, lon). Handles non-Point geometries by using
    the shape's centroid; for a Point, that's the same point."""
    if asset.geom is None:
        return None
    shape = to_shape(asset.geom)
    if isinstance(shape, ShapelyPoint):
        return (shape.y, shape.x)
    centroid = shape.centroid
    return (centroid.y, centroid.x)


def _point_to_latlon(geom) -> tuple[float, float] | None:
    if geom is None:
        return None
    shape = to_shape(geom)
    if isinstance(shape, ShapelyPoint):
        return (shape.y, shape.x)
    centroid = shape.centroid
    return (centroid.y, centroid.x)


def _stub_geocode_label(coords: tuple[float, float]) -> str:
    lat, lon = coords
    return f"~{lat:.4f}, {lon:.4f}"


def resolve_asset(asset: Asset) -> ResolvedLocation:
    coords = _asset_centroid(asset)
    if asset.address_cached:
        return ResolvedLocation(asset.address_cached, "asset_cached", coords, "asset")
    if coords:
        return ResolvedLocation(_stub_geocode_label(coords), "asset_geocoded", coords, "asset")
    return ResolvedLocation(None, "none", None, "none")


def resolve_work_order(wo: WorkOrder) -> ResolvedLocation:
    if wo.address_override:
        # Operator typed something different — that wins. Coords still
        # come from the asset (or manual location) because the override
        # only addresses the *label*, not the geometry.
        if wo.asset_id:
            asset = wo.asset_obj
            coords = _asset_centroid(asset) if asset else None
            return ResolvedLocation(
                wo.address_override,
                "override",
                coords,
                "asset" if coords else "none",
            )
        coords = _point_to_latlon(wo.location)
        return ResolvedLocation(
            wo.address_override,
            "override",
            coords,
            "manual" if coords else "none",
        )

    if wo.asset_id:
        asset = wo.asset_obj
        if asset:
            return resolve_asset(asset)

    if wo.location:
        coords = _point_to_latlon(wo.location)
        return ResolvedLocation(
            _stub_geocode_label(coords) if coords else None,
            "manual_point",
            coords,
            "manual" if coords else "none",
        )
    return ResolvedLocation(None, "none", None, "none")


def resolve_service_request(sr: ServiceRequest) -> ResolvedLocation:
    if sr.address_override:
        coords = None
        coords_src: CoordsSource = "none"
        if sr.asset_id and sr.asset_obj:
            coords = _asset_centroid(sr.asset_obj)
            coords_src = "asset" if coords else "none"
        elif sr.location:
            coords = _point_to_latlon(sr.location)
            coords_src = "manual" if coords else "none"
        return ResolvedLocation(sr.address_override, "override", coords, coords_src)

    if sr.asset_id and sr.asset_obj:
        return resolve_asset(sr.asset_obj)

    if sr.location:
        coords = _point_to_latlon(sr.location)
        return ResolvedLocation(
            _stub_geocode_label(coords) if coords else None,
            "manual_point",
            coords,
            "manual" if coords else "none",
        )

    if sr.reported_address:
        return ResolvedLocation(sr.reported_address, "reported", None, "none")

    return ResolvedLocation(None, "none", None, "none")


def resolve_inspection(insp: Inspection) -> ResolvedLocation:
    if insp.asset_id and insp.asset_obj:
        return resolve_asset(insp.asset_obj)
    if insp.work_order_id and insp.work_order_obj:
        return resolve_work_order(insp.work_order_obj)
    return ResolvedLocation(None, "none", None, "none")
