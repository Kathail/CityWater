from __future__ import annotations

import csv
import io
import json
from typing import Any, BinaryIO, Literal

from flask_login import current_user
from sqlalchemy import select

from app.errors import ValidationError
from app.extensions import db
from app.models import Asset, AssetClass
from app.services.asset_attrs import validate_attrs_against_class
from app.services.asset_uid import next_asset_uid
from app.services.audit import emit_event
from app.services.geometry import geojson_to_wkb

OnConflict = Literal["skip", "update"]

# Fields that participate in CSV/GeoJSON imports. The order is also the CSV
# header order on export.
EDITABLE_FIELDS: tuple[str, ...] = (
    "material",
    "diameter_mm",
    "length_m",
    "depth_m",
    "manufacturer",
    "model",
    "serial_number",
    "install_date",
    "decommission_date",
    "warranty_until",
    "condition",
    "criticality",
    "status",
    "notes",
)

INT_FIELDS = {"diameter_mm", "condition", "criticality"}
DECIMAL_FIELDS = {"length_m", "depth_m"}
DATE_FIELDS = {"install_date", "decommission_date", "warranty_until"}
FLUSH_BATCH = 100


def _coerce(field: str, raw: Any) -> Any:
    if raw is None or raw == "":
        return None
    if field in INT_FIELDS:
        return int(raw)
    if field in DECIMAL_FIELDS:
        # SQLAlchemy Numeric accepts strings; let it parse
        return str(raw)
    return raw


def _existing_by_uid(asset_uid: str | None) -> Asset | None:
    if not asset_uid:
        return None
    return db.session.scalar(select(Asset).where(Asset.asset_uid == asset_uid).execution_options(include_deleted=True))


def _apply_props(asset: Asset, source: dict[str, Any]) -> None:
    for field in EDITABLE_FIELDS:
        if field in source:
            setattr(asset, field, _coerce(field, source[field]))


def _process(
    *,
    class_code: str,
    geom_dict: dict[str, Any],
    asset_uid: str | None,
    props: dict[str, Any],
    on_conflict: OnConflict,
) -> tuple[Literal["created", "updated", "skipped", "failed"], dict | None]:
    if not class_code:
        return "failed", {"code": "missing_class_code", "message": "class_code is required"}

    asset_class = db.session.get(AssetClass, class_code)
    if not asset_class:
        return "failed", {
            "code": "unknown_class",
            "message": f"unknown class_code: {class_code}",
        }

    if geom_dict.get("type") != asset_class.geometry_type:
        return "failed", {
            "code": "geometry_type_mismatch",
            "message": (f"class {class_code} requires {asset_class.geometry_type}, got {geom_dict.get('type')}"),
        }

    attrs = props.get("attrs") or {}
    if attrs:
        try:
            validate_attrs_against_class(attrs, asset_class)
        except ValidationError as e:
            return "failed", {"code": "attrs_invalid", "message": str(e)}

    existing = _existing_by_uid(asset_uid)

    if existing:
        if on_conflict == "skip":
            return "skipped", {
                "code": "asset_uid_taken",
                "message": f"asset_uid {existing.asset_uid} already exists; skipped",
            }
        existing.geom = geojson_to_wkb(geom_dict)
        _apply_props(existing, props)
        if attrs:
            existing.attrs = {**(existing.attrs or {}), **attrs}
        return "updated", None

    new_uid = asset_uid or next_asset_uid(tenant_id=current_user.tenant_id, class_code=class_code)
    asset = Asset(
        tenant_id=current_user.tenant_id,
        asset_uid=new_uid,
        class_code=class_code,
        geom=geojson_to_wkb(geom_dict),
        status=props.get("status") or "active",
        attrs=attrs,
    )
    _apply_props(asset, props)
    db.session.add(asset)
    return "created", None


def _finalize(summary: dict[str, int], dry_run: bool, format_label: str) -> None:
    if dry_run:
        db.session.rollback()
        return
    db.session.flush()
    emit_event(
        action="bulk_import",
        entity_type="Asset",
        entity_id="batch",
        tenant_id=current_user.tenant_id,
        after={**summary, "format": format_label},
    )
    db.session.commit()


def import_csv(stream: BinaryIO, *, on_conflict: OnConflict = "skip", dry_run: bool = False) -> dict:
    """Import CSV. Point classes only — Lines/Polygons rejected per row."""
    text = io.TextIOWrapper(stream, encoding="utf-8-sig", newline="")
    reader = csv.DictReader(text)
    if reader.fieldnames is None:
        raise ValidationError("empty CSV file", code="empty_file")
    reader.fieldnames = [(f or "").lower().strip() for f in reader.fieldnames]

    summary = {"created": 0, "updated": 0, "skipped": 0, "failed": 0}
    errors: list[dict[str, Any]] = []
    processed = 0

    for row_num, raw in enumerate(reader, start=2):  # row 1 is header
        row = {(k or "").lower().strip(): (v if v is not None else "") for k, v in raw.items() if k}

        class_code = (row.get("class_code") or "").strip()
        asset_uid = (row.get("asset_uid") or "").strip() or None

        # CSV is point-only; check class first so users learn quickly
        asset_class = db.session.get(AssetClass, class_code) if class_code else None
        if asset_class and asset_class.geometry_type != "Point":
            errors.append(
                {
                    "row": row_num,
                    "code": "geometry_type_unsupported_in_csv",
                    "message": (
                        f"class {class_code} has geometry type {asset_class.geometry_type}; CSV import is Point-only"
                    ),
                    "raw": row,
                }
            )
            summary["failed"] += 1
            continue

        lon = (row.get("lon") or "").strip()
        lat = (row.get("lat") or "").strip()
        if lon == "" or lat == "":
            errors.append(
                {
                    "row": row_num,
                    "code": "missing_geometry",
                    "message": "lon and lat are required",
                    "raw": row,
                }
            )
            summary["failed"] += 1
            continue
        try:
            geom_dict = {"type": "Point", "coordinates": [float(lon), float(lat)]}
        except ValueError:
            errors.append(
                {
                    "row": row_num,
                    "code": "bad_lon_lat",
                    "message": f"could not parse lon={lon!r}, lat={lat!r}",
                    "raw": row,
                }
            )
            summary["failed"] += 1
            continue

        props = {f: row[f] for f in EDITABLE_FIELDS if f in row and row[f] != ""}

        try:
            outcome, err = _process(
                class_code=class_code,
                geom_dict=geom_dict,
                asset_uid=asset_uid,
                props=props,
                on_conflict=on_conflict,
            )
        except Exception as e:
            db.session.rollback()
            errors.append({"row": row_num, "code": "row_error", "message": str(e), "raw": row})
            summary["failed"] += 1
            continue

        summary[outcome] += 1
        if err:
            errors.append({"row": row_num, "raw": row, **err})

        processed += 1
        if processed % FLUSH_BATCH == 0:
            db.session.flush()

    _finalize(summary, dry_run, "csv")
    return {"summary": summary, "errors": errors}


def import_geojson(stream: BinaryIO, *, on_conflict: OnConflict = "skip", dry_run: bool = False) -> dict:
    try:
        data = json.load(stream)
    except json.JSONDecodeError as e:
        raise ValidationError(f"invalid JSON: {e.msg}", code="bad_json") from e

    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise ValidationError("expected GeoJSON FeatureCollection", code="bad_format")

    features = data.get("features") or []
    if not isinstance(features, list):
        raise ValidationError("'features' must be an array", code="bad_format")

    summary = {"created": 0, "updated": 0, "skipped": 0, "failed": 0}
    errors: list[dict[str, Any]] = []
    processed = 0

    for row_num, feature in enumerate(features, start=1):
        if not isinstance(feature, dict):
            errors.append({"row": row_num, "code": "bad_feature", "message": "feature is not an object"})
            summary["failed"] += 1
            continue

        geom = feature.get("geometry")
        if not isinstance(geom, dict):
            errors.append({"row": row_num, "code": "missing_geometry", "message": "feature missing geometry"})
            summary["failed"] += 1
            continue

        props = feature.get("properties") or {}
        if not isinstance(props, dict):
            errors.append(
                {
                    "row": row_num,
                    "code": "bad_properties",
                    "message": "properties must be an object",
                }
            )
            summary["failed"] += 1
            continue

        class_code = props.get("class_code") or ""
        asset_uid = props.get("asset_uid")
        if asset_uid is not None and not isinstance(asset_uid, str):
            asset_uid = str(asset_uid)
        asset_uid = asset_uid.strip() if asset_uid else None

        try:
            outcome, err = _process(
                class_code=class_code if isinstance(class_code, str) else "",
                geom_dict=geom,
                asset_uid=asset_uid,
                props=props,
                on_conflict=on_conflict,
            )
        except Exception as e:
            db.session.rollback()
            errors.append({"row": row_num, "code": "row_error", "message": str(e)})
            summary["failed"] += 1
            continue

        summary[outcome] += 1
        if err:
            errors.append({"row": row_num, **err})

        processed += 1
        if processed % FLUSH_BATCH == 0:
            db.session.flush()

    _finalize(summary, dry_run, "geojson")
    return {"summary": summary, "errors": errors}
