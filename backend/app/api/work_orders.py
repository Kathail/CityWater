from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import db
from app.models import (
    Asset,
    WorkOrder,
    WorkOrderAttachment,
    WorkOrderMaterial,
    WorkOrderTask,
    WorkOrderTimeLog,
    WoTemplate,
)
from app.schemas.work_order import (
    AttachmentRead,
    MaterialCreate,
    MaterialRead,
    TaskCreate,
    TaskRead,
    TaskUpdate,
    TimeLogCreate,
    TimeLogRead,
    WorkOrderCreate,
    WorkOrderListItem,
    WorkOrderListResponse,
    WorkOrderTransition,
    WorkOrderUpdate,
)
from app.services.audit import emit_event
from app.services.exif import extract_metadata, strip_non_gps_exif
from app.services.geometry import wkb_to_geojson
from app.services.permissions import require_roles
from app.services.storage import upload_attachment
from app.services.wo_number import next_wo_number
from app.services.wo_state import validate_transition

work_orders_bp = Blueprint("work_orders", __name__, url_prefix="/api/v1/work-orders")

_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024  # per-file


def _validate(model_cls, data):
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _user_roles() -> set[str]:
    return {r.code for r in current_user._get_current_object().roles}


def _is_supervisor_or_admin() -> bool:
    return bool(_user_roles() & {"admin", "supervisor"})


def _can_view_wo(wo: WorkOrder) -> bool:
    if _is_supervisor_or_admin() or "readonly" in _user_roles():
        return True
    # Tech: only their own assigned WOs
    return wo.assigned_to == current_user.id


def _serialize_task(t: WorkOrderTask) -> dict[str, Any]:
    return TaskRead.model_validate(t).model_dump(mode="json")


def _serialize_time(tl: WorkOrderTimeLog) -> dict[str, Any]:
    return TimeLogRead.model_validate(tl).model_dump(mode="json")


def _serialize_material(m: WorkOrderMaterial) -> dict[str, Any]:
    return MaterialRead.model_validate(m).model_dump(mode="json")


def _serialize_attachment(a: WorkOrderAttachment) -> dict[str, Any]:
    return AttachmentRead.model_validate(a).model_dump(mode="json")


def _materials_total(wo: WorkOrder) -> Decimal | None:
    total = Decimal("0")
    have_any = False
    for m in wo.materials:
        if m.unit_cost is not None:
            total += (m.quantity or Decimal("0")) * m.unit_cost
            have_any = True
    return total if have_any else None


def _wo_payload(wo: WorkOrder) -> dict[str, Any]:
    asset_uid = None
    if wo.asset_id:
        asset = db.session.get(Asset, wo.asset_id)
        asset_uid = asset.asset_uid if asset else None
    payload = {
        "wo_number": wo.wo_number,
        "type": wo.type,
        "category": wo.category,
        "priority": wo.priority,
        "status": wo.status,
        "title": wo.title,
        "description": wo.description,
        "asset_uid": asset_uid,
        "location": wkb_to_geojson(wo.location),
        "template_id": wo.template_id,
        "scheduled_for": wo.scheduled_for.isoformat() if wo.scheduled_for else None,
        "due_by": wo.due_by.isoformat() if wo.due_by else None,
        "started_at": wo.started_at.isoformat() if wo.started_at else None,
        "completed_at": wo.completed_at.isoformat() if wo.completed_at else None,
        "reported_by": wo.reported_by,
        "assigned_to": wo.assigned_to,
        "crew_id": wo.crew_id,
        "resolution": wo.resolution,
        "attrs": wo.attrs or {},
        "created_at": wo.created_at.isoformat(),
        "updated_at": wo.updated_at.isoformat(),
        "tasks": [_serialize_task(t) for t in sorted(wo.tasks, key=lambda x: (x.sequence, x.id))],
        "time_logs": [_serialize_time(tl) for tl in wo.time_logs],
        "materials": [_serialize_material(m) for m in wo.materials],
        "attachments": [_serialize_attachment(a) for a in wo.attachments],
    }
    total = _materials_total(wo)
    payload["materials_total"] = str(total) if total is not None else None
    return payload


def _list_item(wo: WorkOrder) -> dict[str, Any]:
    asset_uid = None
    if wo.asset_id:
        asset = db.session.get(Asset, wo.asset_id)
        asset_uid = asset.asset_uid if asset else None
    return {
        "wo_number": wo.wo_number,
        "type": wo.type,
        "category": wo.category,
        "priority": wo.priority,
        "status": wo.status,
        "title": wo.title,
        "asset_uid": asset_uid,
        "assigned_to": wo.assigned_to,
        "crew_id": wo.crew_id,
        "due_by": wo.due_by.isoformat() if wo.due_by else None,
        "created_at": wo.created_at.isoformat(),
    }


def _get_wo(wo_number: str) -> WorkOrder:
    wo = db.session.scalar(select(WorkOrder).where(WorkOrder.wo_number == wo_number))
    if not wo:
        raise NotFoundError(f"work order {wo_number} not found")
    if not _can_view_wo(wo):
        raise NotFoundError(f"work order {wo_number} not found")
    return wo


@work_orders_bp.get("")
@login_required
def list_work_orders():
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 50, type=int)))

    stmt = select(WorkOrder)

    status = request.args.get("status")
    if status:
        stmt = stmt.where(WorkOrder.status == status)

    assigned_to = request.args.get("assigned_to")
    if assigned_to == "me":
        stmt = stmt.where(WorkOrder.assigned_to == current_user.id)
    elif assigned_to:
        stmt = stmt.where(WorkOrder.assigned_to == int(assigned_to))

    crew_id = request.args.get("crew_id", type=int)
    if crew_id:
        stmt = stmt.where(WorkOrder.crew_id == crew_id)

    asset_uid = request.args.get("asset_uid")
    if asset_uid:
        stmt = stmt.join(Asset, WorkOrder.asset_id == Asset.id).where(Asset.asset_uid == asset_uid)

    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where((WorkOrder.wo_number.ilike(like)) | (WorkOrder.title.ilike(like)))

    if not _is_supervisor_or_admin() and "readonly" not in _user_roles():
        stmt = stmt.where(WorkOrder.assigned_to == current_user.id)

    total = db.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.session.scalars(
        stmt.order_by(WorkOrder.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    return jsonify(
        WorkOrderListResponse(
            items=[WorkOrderListItem.model_validate(_list_item(w)) for w in items],
            page=page,
            page_size=page_size,
            total=total,
        ).model_dump(mode="json")
    )


@work_orders_bp.post("")
@login_required
@require_roles("admin", "supervisor", "tech", "intake")
def create_work_order():
    data = _validate(WorkOrderCreate, request.get_json(silent=True) or {})

    asset_id = None
    location = None
    if data.asset_uid:
        asset = db.session.scalar(select(Asset).where(Asset.asset_uid == data.asset_uid))
        if not asset:
            raise ValidationError(f"asset {data.asset_uid} not found", code="unknown_asset")
        asset_id = asset.id

    template = None
    if data.from_template_id:
        template = db.session.get(WoTemplate, data.from_template_id)
        if not template:
            raise ValidationError(
                f"template {data.from_template_id} not found", code="unknown_template"
            )

    category = data.category
    priority = data.priority
    if template:
        category = template.category if data.category == "other" else data.category
        if data.priority == "normal":
            priority = template.default_priority

    wo_number = next_wo_number(current_user.tenant_id)
    last_error: IntegrityError | None = None
    for _attempt in range(3):
        wo = WorkOrder(
            tenant_id=current_user.tenant_id,
            wo_number=wo_number,
            type=data.type,
            category=category,
            priority=priority,
            status=data.status,
            title=data.title,
            description=data.description,
            asset_id=asset_id,
            location=location,
            template_id=template.id if template else None,
            scheduled_for=data.scheduled_for,
            due_by=data.due_by,
            reported_by=current_user.id,
            assigned_to=data.assigned_to,
            crew_id=data.crew_id,
            attrs=data.attrs,
        )
        db.session.add(wo)
        try:
            db.session.flush()
        except IntegrityError as e:
            db.session.rollback()
            last_error = e
            wo_number = next_wo_number(current_user.tenant_id)
            continue

        if template:
            for idx, task_def in enumerate(template.task_template or []):
                title = (task_def or {}).get("title")
                if not title:
                    continue
                db.session.add(
                    WorkOrderTask(
                        work_order_id=wo.id,
                        sequence=task_def.get("sequence", idx),
                        title=title,
                        description=task_def.get("description"),
                    )
                )

        db.session.commit()
        db.session.refresh(wo)
        return jsonify(_wo_payload(wo)), 201

    raise ConflictError(
        "could not generate unique wo_number after retries", code="wo_number_collision"
    ) from last_error


@work_orders_bp.get("/<string:wo_number>")
@login_required
def get_work_order(wo_number: str):
    return jsonify(_wo_payload(_get_wo(wo_number)))


@work_orders_bp.patch("/<string:wo_number>")
@login_required
def update_work_order(wo_number: str):
    data = _validate(WorkOrderUpdate, request.get_json(silent=True) or {})
    wo = _get_wo(wo_number)

    is_supervisor = _is_supervisor_or_admin()
    if not is_supervisor:
        # Tech: can edit description, resolution; cannot reassign or change priority/due
        forbidden = {"assigned_to", "crew_id", "priority", "due_by", "category"}
        offending = [f for f in forbidden if getattr(data, f, None) is not None]
        if offending:
            raise ValidationError(
                f"only admin/supervisor can edit: {', '.join(offending)}",
                code="forbidden_fields",
            )

    for field in (
        "category",
        "priority",
        "title",
        "description",
        "scheduled_for",
        "due_by",
        "assigned_to",
        "crew_id",
        "resolution",
        "attrs",
    ):
        val = getattr(data, field)
        if val is not None:
            setattr(wo, field, val)

    db.session.commit()
    db.session.refresh(wo)
    return jsonify(_wo_payload(wo))


@work_orders_bp.post("/<string:wo_number>/transition")
@login_required
def transition_work_order(wo_number: str):
    data = _validate(WorkOrderTransition, request.get_json(silent=True) or {})
    wo = _get_wo(wo_number)
    validate_transition(wo.status, data.to)

    prev_status = wo.status
    wo.status = data.to
    if data.to == "in_progress" and wo.started_at is None:
        wo.started_at = datetime.now(UTC)
    if data.to == "completed" and wo.completed_at is None:
        wo.completed_at = datetime.now(UTC)

    emit_event(
        action="wo_transition",
        entity_type="WorkOrder",
        entity_id=str(wo.id),
        tenant_id=wo.tenant_id,
        before={"status": prev_status},
        after={"status": data.to, "note": data.note},
    )
    db.session.commit()
    db.session.refresh(wo)
    return jsonify(_wo_payload(wo))


@work_orders_bp.post("/<string:wo_number>/tasks")
@login_required
def add_task(wo_number: str):
    data = _validate(TaskCreate, request.get_json(silent=True) or {})
    wo = _get_wo(wo_number)
    next_seq = (
        max((t.sequence for t in wo.tasks), default=-1) + 1
        if data.sequence is None
        else data.sequence
    )
    task = WorkOrderTask(
        work_order_id=wo.id,
        sequence=next_seq,
        title=data.title,
        description=data.description,
    )
    db.session.add(task)
    db.session.commit()
    db.session.refresh(task)
    return jsonify(_serialize_task(task)), 201


@work_orders_bp.patch("/<string:wo_number>/tasks/<int:task_id>")
@login_required
def update_task(wo_number: str, task_id: int):
    data = _validate(TaskUpdate, request.get_json(silent=True) or {})
    wo = _get_wo(wo_number)
    task = db.session.get(WorkOrderTask, task_id)
    if not task or task.work_order_id != wo.id:
        raise NotFoundError(f"task {task_id} not found")

    if data.title is not None:
        task.title = data.title
    if data.description is not None:
        task.description = data.description
    if data.sequence is not None:
        task.sequence = data.sequence
    if data.is_complete is not None and data.is_complete != task.is_complete:
        task.is_complete = data.is_complete
        if data.is_complete:
            task.completed_at = datetime.now(UTC)
            task.completed_by = current_user.id
        else:
            task.completed_at = None
            task.completed_by = None

    db.session.commit()
    db.session.refresh(task)
    return jsonify(_serialize_task(task))


@work_orders_bp.post("/<string:wo_number>/time")
@login_required
def log_time(wo_number: str):
    data = _validate(TimeLogCreate, request.get_json(silent=True) or {})
    wo = _get_wo(wo_number)
    if data.ended_at < data.started_at:
        raise ValidationError("ended_at must be >= started_at", code="bad_time_range")

    delta = (data.ended_at - data.started_at).total_seconds() / 3600
    hours = Decimal(str(round(delta, 2)))
    entry = WorkOrderTimeLog(
        work_order_id=wo.id,
        user_id=current_user.id,
        started_at=data.started_at,
        ended_at=data.ended_at,
        hours_decimal=hours,
        notes=data.notes,
    )
    db.session.add(entry)
    db.session.commit()
    db.session.refresh(entry)
    return jsonify(_serialize_time(entry)), 201


@work_orders_bp.post("/<string:wo_number>/materials")
@login_required
def log_material(wo_number: str):
    data = _validate(MaterialCreate, request.get_json(silent=True) or {})
    wo = _get_wo(wo_number)
    entry = WorkOrderMaterial(
        work_order_id=wo.id,
        material_code=data.material_code,
        description=data.description,
        quantity=data.quantity,
        unit=data.unit,
        unit_cost=data.unit_cost,
    )
    db.session.add(entry)
    db.session.commit()
    db.session.refresh(entry)
    return jsonify(_serialize_material(entry)), 201


@work_orders_bp.post("/<string:wo_number>/attachments")
@login_required
def upload_attachment_endpoint(wo_number: str):
    file = request.files.get("file")
    if not file:
        raise ValidationError("missing 'file' field", code="missing_file")
    kind = (request.form.get("kind") or "").strip() or "doc"
    if kind not in ("photo", "doc", "sketch"):
        raise ValidationError("kind must be photo, doc, or sketch", code="bad_kind")

    wo = _get_wo(wo_number)

    blob = file.stream.read()
    if len(blob) > _ATTACHMENT_MAX_BYTES:
        raise ValidationError(
            f"file exceeds {_ATTACHMENT_MAX_BYTES // (1024 * 1024)} MB",
            code="too_large",
        )

    coords = None
    taken_at = None
    upload_blob = blob
    content_type = file.mimetype or "application/octet-stream"
    if kind == "photo" and content_type.startswith("image/"):
        from io import BytesIO

        coords, taken_at = extract_metadata(BytesIO(blob))
        try:
            upload_blob = strip_non_gps_exif(BytesIO(blob))
        except Exception:
            upload_blob = blob

    from io import BytesIO

    s3_key = upload_attachment(
        BytesIO(upload_blob),
        tenant_id=current_user.tenant_id,
        work_order_id=wo.id,
        filename=file.filename or "file",
        content_type=content_type,
    )

    geo = None
    if coords:
        from app.services.geometry import geojson_to_wkb

        geo = geojson_to_wkb({"type": "Point", "coordinates": list(coords)})

    attachment = WorkOrderAttachment(
        work_order_id=wo.id,
        kind=kind,
        s3_key=s3_key,
        content_type=content_type,
        original_filename=file.filename or "file",
        size_bytes=len(upload_blob),
        taken_at=taken_at,
        geo=geo,
        uploaded_by=current_user.id,
    )
    db.session.add(attachment)
    db.session.commit()
    db.session.refresh(attachment)
    return jsonify(_serialize_attachment(attachment)), 201
