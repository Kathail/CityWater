"""`/resolved` companion endpoints for WO / SR / Inspection.

Returns the merged display payload — editable raw fields side-by-side
with read-through `display.address`, `display.coords`, and (where
applicable) the linked asset summary. The frontend uses these for forms
that show "where" without making the operator type it.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify
from flask_login import current_user, login_required
from sqlalchemy import select

from app.errors import NotFoundError
from app.extensions import db
from app.models import Asset, Inspection, ServiceRequest, WorkOrder
from app.services.resolve import (
    ResolvedLocation,
    resolve_inspection,
    resolve_service_request,
    resolve_work_order,
)


def _user_roles() -> set[str]:
    return {r.code for r in current_user._get_current_object().roles}


def _can_view_wo(wo: WorkOrder) -> bool:
    """Mirror of the per-user gate in api/work_orders.py:_can_view_wo so
    the /resolved companion endpoint enforces the same per-user
    visibility rules. Without this, a tech could read scheduled_for /
    priority / asset summary for any WO in their tenant including ones
    not assigned to them."""
    roles = _user_roles()
    if roles & {"admin", "supervisor", "readonly"}:
        return True
    return wo.assigned_to == current_user.id


resolved_bp = Blueprint("resolved", __name__, url_prefix="/api/v1")


def _display(loc: ResolvedLocation) -> dict[str, Any]:
    return {
        "address": loc.address,
        "address_source": loc.address_source,
        "coords": list(loc.coords) if loc.coords else None,
        "coords_source": loc.coords_source,
    }


def _asset_block(asset: Asset | None) -> dict[str, Any] | None:
    if asset is None:
        return None
    klass = asset.asset_class
    return {
        "asset_uid": asset.asset_uid,
        "class_code": asset.class_code,
        "class_name": klass.name if klass else None,
        "domain": klass.domain if klass else None,
        "material": asset.material,
        "diameter_mm": asset.diameter_mm,
        "install_date": asset.install_date.isoformat() if asset.install_date else None,
    }


@resolved_bp.get("/work-orders/<string:wo_number>/resolved")
@login_required
def resolved_work_order(wo_number: str):
    wo = db.session.scalar(select(WorkOrder).where(WorkOrder.wo_number == wo_number))
    if not wo or not _can_view_wo(wo):
        # Same 404-as-403 pattern as the main detail endpoint —
        # don't leak that the wo_number exists if the caller can't
        # see its content.
        raise NotFoundError(f"work order {wo_number} not found")
    loc = resolve_work_order(wo)
    return jsonify(
        {
            "wo_number": wo.wo_number,
            "title": wo.title,
            "status": wo.status,
            "priority": wo.priority,
            "scheduled_for": wo.scheduled_for.isoformat() if wo.scheduled_for else None,
            "asset": _asset_block(wo.asset_obj),
            "display": _display(loc),
            "linked": {
                "service_request_id": wo.service_request_id,
            },
            "_links": {
                "self": f"/api/v1/work-orders/{wo.wo_number}",
                "asset": (f"/api/v1/assets/{wo.asset_obj.asset_uid}" if wo.asset_obj else None),
            },
        }
    )


@resolved_bp.get("/service-requests/<string:sr_number>/resolved")
@login_required
def resolved_service_request(sr_number: str):
    sr = db.session.scalar(select(ServiceRequest).where(ServiceRequest.sr_number == sr_number))
    if not sr:
        raise NotFoundError(f"service request {sr_number} not found")
    loc = resolve_service_request(sr)
    return jsonify(
        {
            "sr_number": sr.sr_number,
            "category": sr.category,
            "domain": sr.domain,
            "status": sr.status,
            "priority": sr.priority,
            "reported_at": sr.reported_at.isoformat(),
            "reported_address": sr.reported_address,
            "asset": _asset_block(sr.asset_obj),
            "display": _display(loc),
            "linked": {
                "work_order_id": sr.work_order_id,
            },
            "_links": {
                "self": f"/api/v1/service-requests/{sr.sr_number}",
                "asset": (f"/api/v1/assets/{sr.asset_obj.asset_uid}" if sr.asset_obj else None),
            },
        }
    )


@resolved_bp.get("/inspections/<string:inspection_number>/resolved")
@login_required
def resolved_inspection(inspection_number: str):
    insp = db.session.scalar(select(Inspection).where(Inspection.inspection_number == inspection_number))
    if not insp:
        raise NotFoundError(f"inspection {inspection_number} not found")
    loc = resolve_inspection(insp)
    wo = insp.work_order_obj
    return jsonify(
        {
            "inspection_number": insp.inspection_number,
            "kind": insp.kind,
            "performed_at": insp.performed_at.isoformat(),
            "overall_condition": insp.overall_condition,
            "asset": _asset_block(insp.asset_obj),
            "display": _display(loc),
            "linked": {
                "work_order_number": wo.wo_number if wo else None,
            },
            "_links": {
                "self": f"/api/v1/inspections/{insp.inspection_number}",
                "asset": (f"/api/v1/assets/{insp.asset_obj.asset_uid}" if insp.asset_obj else None),
                "work_order": f"/api/v1/work-orders/{wo.wo_number}" if wo else None,
            },
        }
    )
