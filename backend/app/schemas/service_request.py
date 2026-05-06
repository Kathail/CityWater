from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from geojson_pydantic import Point
from pydantic import BaseModel, ConfigDict, EmailStr, Field

SrCategory = Literal[
    "low_pressure",
    "no_water",
    "sewer_backup",
    "flooding",
    "odour",
    "damaged_asset",
    "other",
]
SrDomain = Literal["water", "sewer", "storm"]
SrStatus = Literal["new", "triaged", "dispatched", "closed", "duplicate"]
SrPriority = Literal["low", "normal", "high", "emergency"]
SrClosureReason = Literal["resolved", "duplicate", "no_action", "false_alarm", "deferred"]


class ServiceRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sr_number: str
    category: SrCategory
    domain: SrDomain
    status: SrStatus
    priority: SrPriority
    reported_at: datetime
    caller_name: str | None = None
    caller_phone: str | None = None
    caller_email: str | None = None
    address: str | None = None
    location: dict[str, Any] | None = None
    description: str | None = None
    intake_user_id: int | None = None
    work_order_id: int | None = None
    work_order_number: str | None = None
    closed_at: datetime | None = None
    closure_notes: str | None = None
    closure_reason: SrClosureReason | None = None
    duplicate_of_sr_number: str | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class DuplicateCandidate(BaseModel):
    sr_number: str
    reported_at: datetime
    distance_m: float
    status: SrStatus
    category: SrCategory
    description: str | None = None


class ServiceRequestCreateResponse(BaseModel):
    service_request: ServiceRequestRead
    duplicates: list[DuplicateCandidate] = Field(default_factory=list)


class ServiceRequestListItem(BaseModel):
    sr_number: str
    category: SrCategory
    domain: SrDomain
    status: SrStatus
    priority: SrPriority
    reported_at: datetime
    caller_name: str | None = None
    address: str | None = None
    work_order_number: str | None = None
    created_at: datetime


class ServiceRequestListResponse(BaseModel):
    items: list[ServiceRequestListItem]
    page: int
    page_size: int
    total: int


class ServiceRequestCreate(BaseModel):
    category: SrCategory
    domain: SrDomain
    priority: SrPriority = "normal"
    caller_name: str | None = Field(default=None, max_length=200)
    caller_phone: str | None = Field(default=None, max_length=64)
    caller_email: EmailStr | None = None
    address: str | None = None
    location: Point | None = None
    description: str | None = None
    reported_at: datetime | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class ServiceRequestUpdate(BaseModel):
    category: SrCategory | None = None
    domain: SrDomain | None = None
    priority: SrPriority | None = None
    status: SrStatus | None = None
    caller_name: str | None = Field(default=None, max_length=200)
    caller_phone: str | None = Field(default=None, max_length=64)
    caller_email: EmailStr | None = None
    address: str | None = None
    location: Point | None = None
    description: str | None = None
    closure_notes: str | None = None
    closure_reason: SrClosureReason | None = None
    duplicate_of_sr_number: str | None = None
    attrs: dict[str, Any] | None = None


class WorkOrderDispatchPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: Literal[
        "main_break",
        "flushing",
        "valve_exercise",
        "cleaning",
        "inspection",
        "repair",
        "install",
        "other",
    ] = "other"
    priority: SrPriority | None = None
    asset_uid: str | None = None
    assigned_to: int | None = None
    crew_id: int | None = None
    scheduled_for: datetime | None = None
    due_by: datetime | None = None


class ServiceRequestDispatch(BaseModel):
    work_order: WorkOrderDispatchPayload
