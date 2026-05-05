from __future__ import annotations

from typing import Any

from geoalchemy2 import WKBElement
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import shape as shapely_shape


def geojson_to_wkb(geojson_dict: dict[str, Any], srid: int = 4326) -> WKBElement:
    geom = shapely_shape(geojson_dict)
    return from_shape(geom, srid=srid)


def wkb_to_geojson(wkb: WKBElement | None) -> dict[str, Any] | None:
    if wkb is None:
        return None
    geom = to_shape(wkb)
    return geom.__geo_interface__
