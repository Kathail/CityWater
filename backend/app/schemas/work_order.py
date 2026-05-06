from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

WoType = Literal["planned", "reactive"]
WoCategory = Literal[
    "main_break",
    "flushing",
    "valve_exercise",
    "cleaning",
    "inspection",
    "repair",
    "install",
    "other",
]
WoPriority = Literal["low", "normal", "high", "emergency"]
WoStatus = Literal[
    "draft",
    "open",
    "assigned",
    "in_progress",
    "on_hold",
    "completed",
    "cancelled",
]
AttachmentKind = Literal["photo", "doc", "sketch"]


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sequence: int
    title: str
    description: str | None = None
    is_complete: bool
    completed_at: datetime | None = None


class TimeLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    started_at: datetime
    ended_at: datetime
    hours_decimal: Decimal
    notes: str | None = None


class MaterialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    material_code: str | None = None
    description: str
    quantity: Decimal
    unit: str | None = None
    unit_cost: Decimal | None = None


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: AttachmentKind
    s3_key: str
    content_type: str
    original_filename: str
    size_bytes: int
    taken_at: datetime | None = None


class WorkOrderRead(BaseModel):
    wo_number: str
    type: WoType
    category: WoCategory
    priority: WoPriority
    status: WoStatus
    title: str
    description: str | None = None
    asset_uid: str | None = None
    location: dict[str, Any] | None = None
    template_id: int | None = None
    scheduled_for: datetime | None = None
    due_by: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    reported_by: int | None = None
    assigned_to: int | None = None
    crew_id: int | None = None
    resolution: str | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    tasks: list[TaskRead] = Field(default_factory=list)
    time_logs: list[TimeLogRead] = Field(default_factory=list)
    materials: list[MaterialRead] = Field(default_factory=list)
    attachments: list[AttachmentRead] = Field(default_factory=list)
    materials_total: Decimal | None = None


class WorkOrderListItem(BaseModel):
    wo_number: str
    type: WoType
    category: WoCategory
    priority: WoPriority
    status: WoStatus
    title: str
    asset_uid: str | None = None
    assigned_to: int | None = None
    crew_id: int | None = None
    due_by: datetime | None = None
    created_at: datetime


class WorkOrderListResponse(BaseModel):
    items: list[WorkOrderListItem]
    page: int
    page_size: int
    total: int


class WorkOrderCreate(BaseModel):
    type: WoType = "reactive"
    category: WoCategory = "other"
    priority: WoPriority = "normal"
    status: WoStatus = "draft"
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    asset_uid: str | None = None
    from_template_id: int | None = None
    scheduled_for: datetime | None = None
    due_by: datetime | None = None
    assigned_to: int | None = None
    crew_id: int | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class WorkOrderUpdate(BaseModel):
    category: WoCategory | None = None
    priority: WoPriority | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    scheduled_for: datetime | None = None
    due_by: datetime | None = None
    assigned_to: int | None = None
    crew_id: int | None = None
    resolution: str | None = None
    attrs: dict[str, Any] | None = None


class WorkOrderTransition(BaseModel):
    to: WoStatus
    note: str | None = None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    sequence: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    sequence: int | None = None
    is_complete: bool | None = None


class TimeLogCreate(BaseModel):
    started_at: datetime
    ended_at: datetime
    notes: str | None = None


class MaterialCreate(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    quantity: Decimal = Field(ge=0)
    material_code: str | None = Field(default=None, max_length=64)
    unit: str | None = Field(default=None, max_length=16)
    unit_cost: Decimal | None = Field(default=None, ge=0)


class CrewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    lead_user_id: int | None = None
    is_active: bool


class CrewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    lead_user_id: int | None = None


class WoTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: WoCategory
    default_priority: WoPriority
    applies_to_classes: list[str] = Field(default_factory=list)
    task_template: list[dict[str, Any]] = Field(default_factory=list)
    instructions: str | None = None


class WoTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: WoCategory
    default_priority: WoPriority = "normal"
    applies_to_classes: list[str] = Field(default_factory=list)
    task_template: list[dict[str, Any]] = Field(default_factory=list)
    instructions: str | None = None
