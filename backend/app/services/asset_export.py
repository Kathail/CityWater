from __future__ import annotations

import csv
import io
import json
from collections.abc import Generator

from sqlalchemy import Select

from app.extensions import db
from app.models import Asset
from app.services.asset_import import EDITABLE_FIELDS
from app.services.geometry import wkb_to_geojson

CSV_HEADERS: list[str] = ["class_code", "asset_uid", "lon", "lat", *EDITABLE_FIELDS]

_CHUNK_BYTES = 64 * 1024


def _csv_value(asset: Asset, field: str) -> str:
    raw = getattr(asset, field, None)
    if raw is None:
        return ""
    if field in {"install_date", "decommission_date", "warranty_until"}:
        return raw.isoformat()
    return str(raw)


def stream_csv(query: Select) -> Generator[str, None, None]:
    """Stream Point assets as CSV. Lines/polygons are skipped (CSV is Point-only)."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_HEADERS)
    writer.writeheader()
    yield buffer.getvalue()
    buffer.seek(0)
    buffer.truncate()

    for asset in db.session.scalars(query.execution_options(yield_per=500)):
        if asset.asset_class.geometry_type != "Point":
            continue
        geom = wkb_to_geojson(asset.geom)
        lon, lat = ("", "")
        if geom and geom.get("type") == "Point":
            lon, lat = geom["coordinates"][0], geom["coordinates"][1]
        row = {
            "class_code": asset.class_code,
            "asset_uid": asset.asset_uid,
            "lon": lon,
            "lat": lat,
            **{f: _csv_value(asset, f) for f in EDITABLE_FIELDS},
        }
        writer.writerow(row)
        if buffer.tell() > _CHUNK_BYTES:
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()

    if buffer.tell():
        yield buffer.getvalue()


def _feature(asset: Asset) -> dict:
    return {
        "type": "Feature",
        "geometry": wkb_to_geojson(asset.geom),
        "properties": {
            "asset_uid": asset.asset_uid,
            "class_code": asset.class_code,
            "domain": asset.asset_class.domain,
            **{
                f: (
                    str(getattr(asset, f))
                    if f in {"length_m", "depth_m"} and getattr(asset, f) is not None
                    else (
                        getattr(asset, f).isoformat()
                        if f in {"install_date", "decommission_date", "warranty_until"}
                        and getattr(asset, f) is not None
                        else getattr(asset, f)
                    )
                )
                for f in EDITABLE_FIELDS
            },
            "attrs": asset.attrs,
        },
    }


def stream_geojson(query: Select) -> Generator[str, None, None]:
    yield '{"type":"FeatureCollection","features":['
    first = True
    for asset in db.session.scalars(query.execution_options(yield_per=500)):
        prefix = "" if first else ","
        first = False
        yield prefix + json.dumps(_feature(asset), default=str)
    yield "]}"
