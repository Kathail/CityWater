from __future__ import annotations

import csv
import io
from collections.abc import Generator
from typing import Any

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError

from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import db
from app.models import Asset, WorkOrder
from app.models.inspection import Inspection
from app.schemas.inspection import (
    KIND_DATA_SCHEMA,
    InspectionCreate,
    InspectionKind,
    InspectionListResponse,
    InspectionRead,
    InspectionUpdate,
)
from app.services.hydrant_flow import color_class, gpm_at_20psi
from app.services.inspection_number import next_inspection_number
from app.services.permissions import require_roles

inspections_bp = Blueprint("inspections", __name__, url_prefix="/api/v1/inspections")

# Maps inspection kind → set of asset class codes that may host this inspection.
KIND_ASSET_COMPATIBILITY: dict[str, set[str]] = {
    "hydrant_flow": {"WAT_HYD"},
    "valve_exercise": {"WAT_VLV"},
    "manhole": {"SAN_MH", "STM_MH"},
    "catch_basin": {"STM_CB", "STM_INL"},
    "lift_station_round": {"SAN_LFT"},
    "cctv": {"SAN_MAIN", "STM_MAIN"},
}


def _validate(model_cls, data):
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _user_roles() -> set[str]:
    return {r.code for r in current_user._get_current_object().roles}


def _is_supervisor_or_admin() -> bool:
    return bool(_user_roles() & {"admin", "supervisor"})


def _normalize_data(kind: InspectionKind, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the kind-specific data shape and (for hydrant_flow) compute the
    NFPA 291 derived fields server-side. CCTV bypasses validation in S6."""
    schema = KIND_DATA_SCHEMA.get(kind)
    if schema is None:
        # CCTV — handled in S7; for now accept the payload as-is
        return dict(data)
    try:
        validated = schema.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors()), code="invalid_data") from e
    out = validated.model_dump(mode="json", exclude_none=False)
    if kind == "hydrant_flow":
        gpm20 = gpm_at_20psi(validated.static_psi, validated.residual_psi, validated.flow_gpm)
        out["calc_gpm_at_20psi"] = gpm20
        out["color_class"] = color_class(gpm20)
    return out


def _resolve_asset_id(asset_uid: str | None, kind: str) -> int | None:
    if not asset_uid:
        return None
    asset = db.session.scalar(select(Asset).where(Asset.asset_uid == asset_uid))
    if not asset:
        raise ValidationError(f"asset {asset_uid} not found", code="unknown_asset")
    allowed = KIND_ASSET_COMPATIBILITY.get(kind, set())
    if allowed and asset.class_code not in allowed:
        raise ValidationError(
            (
                f"inspection kind {kind!r} is not compatible with asset class "
                f"{asset.class_code!r} (allowed: {sorted(allowed)})"
            ),
            code="incompatible_asset_class",
        )
    return asset.id


def _resolve_wo_id(wo_number: str | None) -> int | None:
    if not wo_number:
        return None
    wo = db.session.scalar(select(WorkOrder).where(WorkOrder.wo_number == wo_number))
    if not wo:
        raise ValidationError(f"work order {wo_number} not found", code="unknown_work_order")
    return wo.id


def _payload(ins: Inspection) -> dict[str, Any]:
    asset_uid = None
    if ins.asset_id:
        asset = db.session.get(Asset, ins.asset_id)
        asset_uid = asset.asset_uid if asset else None
    wo_number = None
    if ins.work_order_id:
        wo = db.session.get(WorkOrder, ins.work_order_id)
        wo_number = wo.wo_number if wo else None
    return {
        "inspection_number": ins.inspection_number,
        "kind": ins.kind,
        "asset_uid": asset_uid,
        "work_order_number": wo_number,
        "performed_at": ins.performed_at.isoformat(),
        "performed_by": ins.performed_by,
        "overall_condition": ins.overall_condition,
        "pass": ins.pass_,
        "notes": ins.notes,
        "data": ins.data,
        "attrs": ins.attrs,
        "created_at": ins.created_at.isoformat(),
        "updated_at": ins.updated_at.isoformat(),
    }


def _get_inspection(n: str) -> Inspection:
    ins = db.session.scalar(select(Inspection).where(Inspection.inspection_number == n))
    if not ins:
        raise NotFoundError(f"inspection {n} not found")
    if not _is_supervisor_or_admin() and "readonly" not in _user_roles():
        # Tech sees only inspections they performed OR linked to a WO they're assigned to
        own = ins.performed_by == current_user.id
        wo_assigned = False
        if ins.work_order_id:
            wo = db.session.get(WorkOrder, ins.work_order_id)
            wo_assigned = bool(wo and wo.assigned_to == current_user.id)
        if not (own or wo_assigned):
            raise NotFoundError(f"inspection {n} not found")
    return ins


@inspections_bp.get("")
@login_required
def list_inspections():
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 50, type=int)))

    stmt = select(Inspection)

    kind = request.args.get("kind")
    if kind:
        stmt = stmt.where(Inspection.kind == kind)

    asset_uid = request.args.get("asset_uid")
    if asset_uid:
        stmt = stmt.join(Asset, Inspection.asset_id == Asset.id).where(Asset.asset_uid == asset_uid)

    wo_number = request.args.get("work_order")
    if wo_number:
        stmt = stmt.join(WorkOrder, Inspection.work_order_id == WorkOrder.id).where(
            WorkOrder.wo_number == wo_number
        )

    after = request.args.get("performed_after")
    if after:
        stmt = stmt.where(Inspection.performed_at >= after)
    before = request.args.get("performed_before")
    if before:
        stmt = stmt.where(Inspection.performed_at <= before)

    pass_ = request.args.get("pass")
    if pass_ is not None:
        stmt = stmt.where(Inspection.pass_ == (pass_.lower() == "true"))

    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Inspection.inspection_number.ilike(like)) | (Inspection.notes.ilike(like))
        )

    if not _is_supervisor_or_admin() and "readonly" not in _user_roles():
        stmt = stmt.where(Inspection.performed_by == current_user.id)

    total = db.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.session.scalars(
        stmt.order_by(Inspection.performed_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return jsonify(
        InspectionListResponse(
            items=[InspectionRead.model_validate(_payload(i)) for i in items],
            page=page,
            page_size=page_size,
            total=total,
        ).model_dump(mode="json", by_alias=True)
    )


@inspections_bp.post("")
@login_required
@require_roles("admin", "supervisor", "tech")
def create_inspection():
    data = _validate(InspectionCreate, request.get_json(silent=True) or {})

    # CCTV is reserved for S7 — reject explicitly so the message is clear.
    if data.kind == "cctv":
        raise ValidationError(
            "CCTV inspections are not yet supported (lands in S7)",
            code="cctv_not_yet_supported",
        )

    normalized_data = _normalize_data(data.kind, data.data)
    asset_id = _resolve_asset_id(data.asset_uid, data.kind)
    work_order_id = _resolve_wo_id(data.work_order_number)

    inspection_number = next_inspection_number(current_user.tenant_id)
    last_error: IntegrityError | None = None
    for _attempt in range(3):
        ins = Inspection(
            tenant_id=current_user.tenant_id,
            inspection_number=inspection_number,
            kind=data.kind,
            asset_id=asset_id,
            work_order_id=work_order_id,
            performed_at=data.performed_at,
            performed_by=current_user.id,
            overall_condition=data.overall_condition,
            pass_=data.pass_,
            notes=data.notes,
            data=normalized_data,
            attrs=data.attrs,
        )
        db.session.add(ins)
        try:
            db.session.commit()
            db.session.refresh(ins)
            return jsonify(_payload(ins)), 201
        except IntegrityError as e:
            db.session.rollback()
            last_error = e
            inspection_number = next_inspection_number(current_user.tenant_id)
    raise ConflictError(
        "could not generate unique inspection_number after retries",
        code="number_collision",
    ) from last_error


@inspections_bp.get("/<string:inspection_number>")
@login_required
def get_inspection(inspection_number: str):
    ins = _get_inspection(inspection_number)
    return jsonify(_payload(ins))


@inspections_bp.patch("/<string:inspection_number>")
@login_required
def update_inspection(inspection_number: str):
    data = _validate(InspectionUpdate, request.get_json(silent=True) or {})
    ins = _get_inspection(inspection_number)

    if data.performed_at is not None:
        ins.performed_at = data.performed_at
    if data.overall_condition is not None:
        ins.overall_condition = data.overall_condition
    if data.pass_ is not None:
        ins.pass_ = data.pass_
    if data.notes is not None:
        ins.notes = data.notes
    if data.data is not None:
        ins.data = _normalize_data(ins.kind, data.data)

    db.session.commit()
    db.session.refresh(ins)
    return jsonify(_payload(ins))


@inspections_bp.get("/export")
@login_required
def export_inspections():
    fmt = request.args.get("format", "csv")
    if fmt != "csv":
        raise ValidationError("only format=csv is supported in S6", code="bad_format")
    kind = request.args.get("kind")

    stmt = select(Inspection)
    if kind:
        stmt = stmt.where(Inspection.kind == kind)
    if not _is_supervisor_or_admin() and "readonly" not in _user_roles():
        stmt = stmt.where(Inspection.performed_by == current_user.id)
    stmt = stmt.order_by(Inspection.performed_at)

    suffix = f"-{kind}" if kind else ""
    return Response(
        stream_with_context(_stream_csv(stmt, kind)),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="inspections{suffix}.csv"',
            "Cache-Control": "private, no-store",
        },
    )


def _stream_csv(stmt: Select, kind: str | None) -> Generator[str, None, None]:
    """Common columns plus kind-specific data keys when `kind` is set."""
    common = [
        "inspection_number",
        "kind",
        "asset_uid",
        "performed_at",
        "overall_condition",
        "pass",
        "notes",
    ]
    extra: list[str] = []
    if kind:
        schema = KIND_DATA_SCHEMA.get(kind)
        if schema is not None:
            extra = list(schema.model_fields.keys())
        if kind == "hydrant_flow":
            extra += ["calc_gpm_at_20psi", "color_class"]

    headers = common + extra
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers)
    writer.writeheader()
    yield buffer.getvalue()
    buffer.seek(0)
    buffer.truncate()

    for ins in db.session.scalars(stmt.execution_options(yield_per=500)):
        row = {
            "inspection_number": ins.inspection_number,
            "kind": ins.kind,
            "asset_uid": "",
            "performed_at": ins.performed_at.isoformat(),
            "overall_condition": ins.overall_condition or "",
            "pass": "" if ins.pass_ is None else str(ins.pass_).lower(),
            "notes": ins.notes or "",
        }
        if ins.asset_id:
            asset = db.session.get(Asset, ins.asset_id)
            row["asset_uid"] = asset.asset_uid if asset else ""
        if extra:
            for key in extra:
                v = (ins.data or {}).get(key)
                row[key] = "" if v is None else str(v)
        writer.writerow(row)
        if buffer.tell() > 64 * 1024:
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()
    if buffer.tell():
        yield buffer.getvalue()
