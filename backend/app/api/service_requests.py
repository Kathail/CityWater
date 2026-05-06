from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.errors import ConflictError, NotFoundError, ValidationError
from app.extensions import db
from app.models import Asset, ServiceRequest, WorkOrder
from app.schemas.service_request import (
    DuplicateCandidate,
    ServiceRequestCreate,
    ServiceRequestCreateResponse,
    ServiceRequestDispatch,
    ServiceRequestListItem,
    ServiceRequestListResponse,
    ServiceRequestRead,
    ServiceRequestUpdate,
)
from app.services.audit import emit_event
from app.services.geocode import reverse_geocode
from app.services.geometry import geojson_to_wkb, wkb_to_geojson
from app.services.permissions import require_roles
from app.services.sr_duplicates import find_duplicates
from app.services.sr_number import next_sr_number
from app.services.wo_number import next_wo_number

service_requests_bp = Blueprint("service_requests", __name__, url_prefix="/api/v1/service-requests")


def _validate(model_cls, data):
    try:
        return model_cls.model_validate(data)
    except PydanticValidationError as e:
        raise ValidationError(str(e.errors())) from e


def _user_roles() -> set[str]:
    return {r.code for r in current_user._get_current_object().roles}


def _can_dispatch() -> bool:
    return bool(_user_roles() & {"admin", "supervisor"})


def _can_triage() -> bool:
    return bool(_user_roles() & {"admin", "supervisor"})


def _payload(sr: ServiceRequest) -> dict[str, Any]:
    wo_number = None
    if sr.work_order_id:
        wo = db.session.get(WorkOrder, sr.work_order_id)
        wo_number = wo.wo_number if wo else None
    dup_sr_number = None
    if sr.duplicate_of_id:
        parent = db.session.get(ServiceRequest, sr.duplicate_of_id)
        dup_sr_number = parent.sr_number if parent else None
    return {
        "sr_number": sr.sr_number,
        "category": sr.category,
        "domain": sr.domain,
        "status": sr.status,
        "priority": sr.priority,
        "reported_at": sr.reported_at.isoformat(),
        "caller_name": sr.caller_name,
        "caller_phone": sr.caller_phone,
        "caller_email": sr.caller_email,
        "address": sr.address,
        "location": wkb_to_geojson(sr.location),
        "description": sr.description,
        "intake_user_id": sr.intake_user_id,
        "work_order_id": sr.work_order_id,
        "work_order_number": wo_number,
        "closed_at": sr.closed_at.isoformat() if sr.closed_at else None,
        "closure_notes": sr.closure_notes,
        "closure_reason": sr.closure_reason,
        "duplicate_of_sr_number": dup_sr_number,
        "attrs": sr.attrs or {},
        "created_at": sr.created_at.isoformat(),
        "updated_at": sr.updated_at.isoformat(),
    }


def _list_item(sr: ServiceRequest) -> dict[str, Any]:
    wo_number = None
    if sr.work_order_id:
        wo = db.session.get(WorkOrder, sr.work_order_id)
        wo_number = wo.wo_number if wo else None
    return {
        "sr_number": sr.sr_number,
        "category": sr.category,
        "domain": sr.domain,
        "status": sr.status,
        "priority": sr.priority,
        "reported_at": sr.reported_at.isoformat(),
        "caller_name": sr.caller_name,
        "address": sr.address,
        "work_order_number": wo_number,
        "created_at": sr.created_at.isoformat(),
    }


def _get_sr(sr_number: str) -> ServiceRequest:
    sr = db.session.scalar(select(ServiceRequest).where(ServiceRequest.sr_number == sr_number))
    if not sr:
        raise NotFoundError(f"service request {sr_number} not found")
    return sr


def _location_wkb(loc_dict: dict[str, Any] | None):
    if not loc_dict:
        return None
    return geojson_to_wkb(loc_dict)


@service_requests_bp.get("")
@login_required
def list_service_requests():
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 50, type=int)))

    stmt = select(ServiceRequest)

    status = request.args.get("status")
    if status:
        stmt = stmt.where(ServiceRequest.status == status)

    category = request.args.get("category")
    if category:
        stmt = stmt.where(ServiceRequest.category == category)

    domain = request.args.get("domain")
    if domain:
        stmt = stmt.where(ServiceRequest.domain == domain)

    since = request.args.get("since")
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
        except ValueError as e:
            raise ValidationError("`since` must be ISO-8601", code="bad_since") from e
        stmt = stmt.where(ServiceRequest.reported_at >= since_dt)

    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                ServiceRequest.sr_number.ilike(like),
                ServiceRequest.caller_name.ilike(like),
                ServiceRequest.address.ilike(like),
                ServiceRequest.description.ilike(like),
            )
        )

    total = db.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.session.scalars(
        stmt.order_by(ServiceRequest.reported_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return jsonify(
        ServiceRequestListResponse(
            items=[ServiceRequestListItem.model_validate(_list_item(s)) for s in items],
            page=page,
            page_size=page_size,
            total=total,
        ).model_dump(mode="json")
    )


@service_requests_bp.post("")
@login_required
@require_roles("admin", "supervisor", "tech", "intake")
def create_service_request():
    data = _validate(ServiceRequestCreate, request.get_json(silent=True) or {})

    location_dict: dict[str, Any] | None = None
    if data.location is not None:
        location_dict = data.location.model_dump()
    elif data.address:
        coords = reverse_geocode(data.address)
        if coords is not None:
            lon, lat = coords
            location_dict = {"type": "Point", "coordinates": [lon, lat]}

    location_wkb = _location_wkb(location_dict)
    reported_at = data.reported_at or datetime.now(UTC)

    duplicates: list[tuple[ServiceRequest, float]] = []
    if location_wkb is not None:
        duplicates = find_duplicates(
            tenant_id=current_user.tenant_id,
            location=location_wkb,
            reported_at=reported_at,
        )

    sr_number = next_sr_number(current_user.tenant_id)
    last_error: IntegrityError | None = None
    sr: ServiceRequest | None = None
    for _attempt in range(3):
        sr = ServiceRequest(
            tenant_id=current_user.tenant_id,
            sr_number=sr_number,
            category=data.category,
            domain=data.domain,
            priority=data.priority,
            status="new",
            reported_at=reported_at,
            caller_name=data.caller_name,
            caller_phone=data.caller_phone,
            caller_email=data.caller_email,
            address=data.address,
            location=location_wkb,
            description=data.description,
            intake_user_id=current_user.id,
            attrs=data.attrs,
        )
        db.session.add(sr)
        try:
            db.session.flush()
            break
        except IntegrityError as e:
            db.session.rollback()
            last_error = e
            sr_number = next_sr_number(current_user.tenant_id)
            sr = None
            continue

    if sr is None:
        raise ConflictError(
            "could not generate unique sr_number after retries",
            code="sr_number_collision",
        ) from last_error

    db.session.commit()
    db.session.refresh(sr)

    duplicate_payload = [
        DuplicateCandidate(
            sr_number=other.sr_number,
            reported_at=other.reported_at,
            distance_m=round(distance, 2),
            status=other.status,
            category=other.category,
            description=other.description,
        )
        for other, distance in duplicates
    ]

    response = ServiceRequestCreateResponse(
        service_request=ServiceRequestRead.model_validate(_payload(sr)),
        duplicates=duplicate_payload,
    )
    return jsonify(response.model_dump(mode="json")), 201


@service_requests_bp.get("/<string:sr_number>")
@login_required
def get_service_request(sr_number: str):
    return jsonify(_payload(_get_sr(sr_number)))


@service_requests_bp.patch("/<string:sr_number>")
@login_required
def update_service_request(sr_number: str):
    data = _validate(ServiceRequestUpdate, request.get_json(silent=True) or {})
    sr = _get_sr(sr_number)

    is_supervisor = _can_triage()

    # Tech/intake can update caller info or description on their own intakes
    # but cannot retriage (status, priority, category/domain) or close.
    if not is_supervisor:
        forbidden = {"status", "priority", "category", "domain", "closure_reason", "closure_notes"}
        offending = [f for f in forbidden if getattr(data, f, None) is not None]
        if offending:
            raise ValidationError(
                f"only admin/supervisor can edit: {', '.join(offending)}",
                code="forbidden_fields",
            )

    prev_status = sr.status
    prev_priority = sr.priority

    if data.status is not None:
        if data.status not in {"new", "triaged", "closed", "duplicate"}:
            # `dispatched` is only set via the dispatch endpoint
            raise ValidationError(
                "status must be new, triaged, closed, or duplicate",
                code="bad_status",
            )
        sr.status = data.status
        if data.status == "closed" and sr.closed_at is None:
            sr.closed_at = datetime.now(UTC)
        if data.status == "duplicate" and data.duplicate_of_sr_number:
            parent = db.session.scalar(
                select(ServiceRequest).where(
                    ServiceRequest.sr_number == data.duplicate_of_sr_number
                )
            )
            if not parent:
                raise ValidationError(
                    f"duplicate parent {data.duplicate_of_sr_number} not found",
                    code="unknown_parent",
                )
            sr.duplicate_of_id = parent.id

    for field in (
        "category",
        "domain",
        "priority",
        "caller_name",
        "caller_phone",
        "caller_email",
        "address",
        "description",
        "closure_notes",
        "closure_reason",
        "attrs",
    ):
        val = getattr(data, field)
        if val is not None:
            setattr(sr, field, val)

    if data.location is not None:
        sr.location = geojson_to_wkb(data.location.model_dump())

    if data.status is not None and data.status != prev_status:
        emit_event(
            action="sr_transition",
            entity_type="ServiceRequest",
            entity_id=str(sr.id),
            tenant_id=sr.tenant_id,
            before={"status": prev_status, "priority": prev_priority},
            after={"status": sr.status, "priority": sr.priority},
        )

    db.session.commit()
    db.session.refresh(sr)
    return jsonify(_payload(sr))


@service_requests_bp.post("/<string:sr_number>/dispatch")
@login_required
@require_roles("admin", "supervisor")
def dispatch_service_request(sr_number: str):
    if not _can_dispatch():
        raise ValidationError("only admin/supervisor can dispatch", code="forbidden_role")

    data = _validate(ServiceRequestDispatch, request.get_json(silent=True) or {})
    sr = _get_sr(sr_number)

    if sr.status in {"closed", "duplicate"}:
        raise ConflictError(
            f"cannot dispatch a {sr.status} service request",
            code="bad_status_for_dispatch",
        )

    wo_payload = data.work_order

    asset_id = None
    if wo_payload.asset_uid:
        asset = db.session.scalar(select(Asset).where(Asset.asset_uid == wo_payload.asset_uid))
        if not asset:
            raise ValidationError(f"asset {wo_payload.asset_uid} not found", code="unknown_asset")
        asset_id = asset.id

    priority = wo_payload.priority or sr.priority

    wo_number = next_wo_number(current_user.tenant_id)
    last_error: IntegrityError | None = None
    wo: WorkOrder | None = None
    for _attempt in range(3):
        wo = WorkOrder(
            tenant_id=current_user.tenant_id,
            wo_number=wo_number,
            type="reactive",
            category=wo_payload.category,
            priority=priority,
            status="open",
            title=wo_payload.title,
            description=wo_payload.description,
            asset_id=asset_id,
            location=sr.location,
            scheduled_for=wo_payload.scheduled_for,
            due_by=wo_payload.due_by,
            reported_by=current_user.id,
            assigned_to=wo_payload.assigned_to,
            crew_id=wo_payload.crew_id,
            service_request_id=sr.id,
        )
        db.session.add(wo)
        try:
            db.session.flush()
            break
        except IntegrityError as e:
            db.session.rollback()
            last_error = e
            wo_number = next_wo_number(current_user.tenant_id)
            wo = None
            continue

    if wo is None:
        raise ConflictError(
            "could not generate unique wo_number after retries",
            code="wo_number_collision",
        ) from last_error

    prev_status = sr.status
    sr.status = "dispatched"
    sr.work_order_id = wo.id

    emit_event(
        action="sr_dispatch",
        entity_type="ServiceRequest",
        entity_id=str(sr.id),
        tenant_id=sr.tenant_id,
        before={"status": prev_status},
        after={"status": "dispatched", "wo_number": wo.wo_number},
    )

    db.session.commit()
    db.session.refresh(sr)
    return jsonify(_payload(sr))
