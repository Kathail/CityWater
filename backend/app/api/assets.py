from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import db
from app.models import Asset, AssetClass, AuditLog, User
from app.schemas.asset import AssetCreate, AssetUpdate
from app.services.asset_attrs import validate_attrs_against_class
from app.services.asset_export import stream_csv, stream_geojson
from app.services.asset_import import import_csv, import_geojson
from app.services.asset_uid import next_asset_uid
from app.services.geometry import geojson_to_wkb, wkb_to_geojson
from app.services.permissions import require_roles

assets_bp = Blueprint("assets", __name__, url_prefix="/api/v1/assets")


def _validate(model_cls, data):
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _payload(asset: Asset) -> dict[str, Any]:
    return {
        "asset_uid": asset.asset_uid,
        "class_code": asset.class_code,
        "domain": asset.asset_class.domain if asset.asset_class else "",
        "geometry": wkb_to_geojson(asset.geom),
        "install_date": asset.install_date.isoformat() if asset.install_date else None,
        "decommission_date": (
            asset.decommission_date.isoformat() if asset.decommission_date else None
        ),
        "material": asset.material,
        "diameter_mm": asset.diameter_mm,
        "length_m": str(asset.length_m) if asset.length_m is not None else None,
        "depth_m": str(asset.depth_m) if asset.depth_m is not None else None,
        "manufacturer": asset.manufacturer,
        "model": asset.model,
        "serial_number": asset.serial_number,
        "warranty_until": (asset.warranty_until.isoformat() if asset.warranty_until else None),
        "condition": asset.condition,
        "criticality": asset.criticality,
        "status": asset.status,
        "attrs": asset.attrs,
        "notes": asset.notes,
        "created_at": asset.created_at.isoformat(),
        "updated_at": asset.updated_at.isoformat(),
    }


def _get_asset(asset_uid: str) -> Asset:
    asset = db.session.scalar(select(Asset).where(Asset.asset_uid == asset_uid))
    if not asset:
        raise NotFoundError(f"asset {asset_uid} not found")
    return asset


def _parse_bbox(raw: str) -> tuple[float, float, float, float]:
    try:
        parts = [float(x) for x in raw.split(",")]
    except (ValueError, AttributeError) as e:
        raise ValidationError("bbox must be 'minLon,minLat,maxLon,maxLat'", code="bad_bbox") from e
    if len(parts) != 4:
        raise ValidationError("bbox must be 'minLon,minLat,maxLon,maxLat'", code="bad_bbox")
    return tuple(parts)  # type: ignore[return-value]


@assets_bp.get("")
@login_required
def list_assets():
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 50, type=int)))

    stmt = select(Asset)

    klass = request.args.get("class")
    if klass:
        stmt = stmt.where(Asset.class_code == klass)

    domain = request.args.get("domain")
    if domain:
        stmt = stmt.join(AssetClass, Asset.class_code == AssetClass.code).where(
            AssetClass.domain == domain
        )

    status = request.args.get("status")
    if status:
        stmt = stmt.where(Asset.status == status)

    bbox = request.args.get("bbox")
    if bbox:
        min_lon, min_lat, max_lon, max_lat = _parse_bbox(bbox)
        stmt = stmt.where(
            func.ST_Intersects(
                Asset.geom,
                func.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326),
            )
        )

    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Asset.asset_uid.ilike(like))
            | (Asset.material.ilike(like))
            | (Asset.manufacturer.ilike(like))
        )

    total = db.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.session.scalars(
        stmt.order_by(Asset.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    return jsonify(
        {
            "items": [_payload(a) for a in items],
            "page": page,
            "page_size": page_size,
            "total": total,
        }
    )


@assets_bp.post("")
@login_required
@require_roles("admin", "supervisor")
def create_asset():
    data = _validate(AssetCreate, request.get_json(silent=True) or {})

    asset_class = db.session.get(AssetClass, data.class_code)
    if not asset_class:
        raise ValidationError(f"unknown class_code: {data.class_code}", code="unknown_class")

    geom_dict = data.geometry.model_dump(mode="json")
    if geom_dict.get("type") != asset_class.geometry_type:
        raise ValidationError(
            f"class {data.class_code} requires geometry type "
            f"{asset_class.geometry_type}, got {geom_dict.get('type')}",
            code="geometry_type_mismatch",
        )

    validate_attrs_against_class(data.attrs, asset_class)

    asset_uid = data.asset_uid or next_asset_uid(
        tenant_id=current_user.tenant_id, class_code=data.class_code
    )

    last_error: IntegrityError | None = None
    for _attempt in range(3):
        asset = Asset(
            tenant_id=current_user.tenant_id,
            asset_uid=asset_uid,
            class_code=data.class_code,
            geom=geojson_to_wkb(geom_dict),
            install_date=data.install_date,
            decommission_date=data.decommission_date,
            material=data.material,
            diameter_mm=data.diameter_mm,
            length_m=data.length_m,
            depth_m=data.depth_m,
            manufacturer=data.manufacturer,
            model=data.model,
            serial_number=data.serial_number,
            warranty_until=data.warranty_until,
            condition=data.condition,
            criticality=data.criticality,
            status=data.status,
            attrs=data.attrs,
            notes=data.notes,
        )
        db.session.add(asset)
        try:
            db.session.commit()
            db.session.refresh(asset)
            return jsonify(_payload(asset)), 201
        except IntegrityError as e:
            db.session.rollback()
            last_error = e
            if data.asset_uid is not None:
                raise ConflictError(
                    f"asset_uid '{data.asset_uid}' already exists",
                    code="asset_uid_taken",
                ) from e
            asset_uid = next_asset_uid(tenant_id=current_user.tenant_id, class_code=data.class_code)
    raise ConflictError(
        "could not generate unique asset_uid after retries",
        code="uid_collision",
    ) from last_error


@assets_bp.get("/<string:asset_uid>")
@login_required
def get_asset(asset_uid: str):
    asset = _get_asset(asset_uid)
    return jsonify(_payload(asset))


@assets_bp.patch("/<string:asset_uid>")
@login_required
@require_roles("admin", "supervisor")
def update_asset(asset_uid: str):
    data = _validate(AssetUpdate, request.get_json(silent=True) or {})
    asset = _get_asset(asset_uid)

    if data.attrs is not None:
        validate_attrs_against_class(data.attrs, asset.asset_class)

    if data.geometry is not None:
        geom_dict = data.geometry.model_dump(mode="json")
        if geom_dict["type"] != asset.asset_class.geometry_type:
            raise ValidationError(
                f"geometry type {geom_dict['type']} does not match class "
                f"{asset.class_code} ({asset.asset_class.geometry_type})",
                code="geometry_type_mismatch",
            )
        asset.geom = geojson_to_wkb(geom_dict)

    update_data = data.model_dump(exclude_unset=True, exclude={"geometry"})
    for field, value in update_data.items():
        setattr(asset, field, value)

    db.session.commit()
    db.session.refresh(asset)
    return jsonify(_payload(asset))


@assets_bp.delete("/<string:asset_uid>")
@login_required
@require_roles("admin", "supervisor")
def soft_delete_asset(asset_uid: str):
    asset = _get_asset(asset_uid)
    asset.deleted_at = datetime.now(UTC)
    db.session.commit()
    return "", 204


@assets_bp.get("/<string:asset_uid>/history")
@login_required
def get_asset_history(asset_uid: str):
    asset = _get_asset(asset_uid)
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 50, type=int)))

    stmt = (
        select(AuditLog, User.user_uid, User.full_name)
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(
            AuditLog.entity_type == "Asset",
            AuditLog.entity_id == str(asset.id),
        )
        .order_by(AuditLog.occurred_at.desc())
    )
    total = db.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.session.execute(stmt.offset((page - 1) * page_size).limit(page_size)).all()

    items = []
    for entry, user_uid, full_name in rows:
        items.append(
            {
                "occurred_at": entry.occurred_at.isoformat(),
                "action": entry.action,
                "before": entry.before,
                "after": entry.after,
                "user_uid": user_uid,
                "user_full_name": full_name,
            }
        )

    return jsonify(
        {
            "items": items,
            "page": page,
            "page_size": page_size,
            "total": total,
        }
    )


def _build_asset_query() -> Any:
    """Shared query-builder used by list_assets and export_assets."""
    stmt = select(Asset)

    klass = request.args.get("class")
    if klass:
        stmt = stmt.where(Asset.class_code == klass)

    domain = request.args.get("domain")
    if domain:
        stmt = stmt.join(AssetClass, Asset.class_code == AssetClass.code).where(
            AssetClass.domain == domain
        )

    status = request.args.get("status")
    if status:
        stmt = stmt.where(Asset.status == status)

    bbox = request.args.get("bbox")
    if bbox:
        min_lon, min_lat, max_lon, max_lat = _parse_bbox(bbox)
        stmt = stmt.where(
            func.ST_Intersects(
                Asset.geom,
                func.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326),
            )
        )

    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Asset.asset_uid.ilike(like))
            | (Asset.material.ilike(like))
            | (Asset.manufacturer.ilike(like))
        )
    return stmt


@assets_bp.post("/import")
@login_required
@require_roles("admin", "supervisor")
def import_assets():
    file = request.files.get("file")
    if not file:
        raise ValidationError("missing 'file' field", code="missing_file")
    # Per-route 10 MB cap; global MAX_CONTENT_LENGTH is 25 MB for attachments.
    file.stream.seek(0, 2)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > 10 * 1024 * 1024:
        from flask import abort

        abort(413)

    on_conflict = request.form.get("on_conflict", "skip")
    if on_conflict not in ("skip", "update"):
        raise ValidationError("on_conflict must be 'skip' or 'update'", code="bad_on_conflict")
    dry_run = request.form.get("dry_run", "").lower() == "true"

    filename = (file.filename or "").lower()
    if filename.endswith(".csv"):
        result = import_csv(file.stream, on_conflict=on_conflict, dry_run=dry_run)
    elif filename.endswith(".geojson") or filename.endswith(".json"):
        result = import_geojson(file.stream, on_conflict=on_conflict, dry_run=dry_run)
    else:
        raise ValidationError("file must be .csv, .geojson, or .json", code="unsupported_format")
    return jsonify(result)


@assets_bp.get("/export")
@login_required
def export_assets():
    fmt = request.args.get("format", "geojson")
    if fmt not in ("csv", "geojson"):
        raise ValidationError("format must be 'csv' or 'geojson'", code="bad_format")

    stmt = _build_asset_query().order_by(Asset.created_at)

    if fmt == "csv":
        return Response(
            stream_with_context(stream_csv(stmt)),
            mimetype="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="assets.csv"',
                "Cache-Control": "private, no-store",
            },
        )
    return Response(
        stream_with_context(stream_geojson(stmt)),
        mimetype="application/geo+json",
        headers={
            "Content-Disposition": 'attachment; filename="assets.geojson"',
            "Cache-Control": "private, no-store",
        },
    )
