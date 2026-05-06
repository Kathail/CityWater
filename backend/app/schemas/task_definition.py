from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Produces = Literal["work_order", "inspection", "service_request"]
Status = Literal["draft", "active", "archived"]
Domain = Literal["water", "sewer", "storm", "any"]


class TaskDefinitionBrief(BaseModel):
    """Trimmed payload for catalog listings — omits the JSONB blobs."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    version: int
    status: Status
    title: str
    summary: str | None = None
    produces: Produces
    default_category: str | None = None
    default_priority: str | None = None
    default_domain: Domain | None = None
    applies_to_classes: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class TaskDefinitionRead(TaskDefinitionBrief):
    triggers: list[dict[str, Any]] = Field(default_factory=list)
    prefill: dict[str, Any] = Field(default_factory=dict)
    form: list[dict[str, Any]] = Field(default_factory=list)
    canned_comments: list[str] = Field(default_factory=list)
    procedure: dict[str, Any] = Field(default_factory=dict)
    completion: dict[str, Any] = Field(default_factory=dict)
    spawns: list[dict[str, Any]] = Field(default_factory=list)
    clocks: list[dict[str, Any]] = Field(default_factory=list)
    lang: str = "en"


class TaskDefinitionListResponse(BaseModel):
    items: list[TaskDefinitionBrief]


class TaskDefinitionCreate(BaseModel):
    code: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=300)
    summary: str | None = None
    produces: Produces
    default_category: str | None = None
    default_priority: str | None = None
    default_domain: Domain | None = None
    applies_to_classes: list[str] = Field(default_factory=list)
    triggers: list[dict[str, Any]] = Field(default_factory=list)
    prefill: dict[str, Any] = Field(default_factory=dict)
    form: list[dict[str, Any]] = Field(default_factory=list)
    canned_comments: list[str] = Field(default_factory=list)
    procedure: dict[str, Any] = Field(default_factory=dict)
    completion: dict[str, Any] = Field(default_factory=dict)
    spawns: list[dict[str, Any]] = Field(default_factory=list)
    clocks: list[dict[str, Any]] = Field(default_factory=list)


class TaskDefinitionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    summary: str | None = None
    default_category: str | None = None
    default_priority: str | None = None
    default_domain: Domain | None = None
    applies_to_classes: list[str] | None = None
    triggers: list[dict[str, Any]] | None = None
    prefill: dict[str, Any] | None = None
    form: list[dict[str, Any]] | None = None
    canned_comments: list[str] | None = None
    procedure: dict[str, Any] | None = None
    completion: dict[str, Any] | None = None
    spawns: list[dict[str, Any]] | None = None
    clocks: list[dict[str, Any]] | None = None


class MatchRequest(BaseModel):
    source: Literal["service_request", "manual", "asset", "work_order"]
    payload: dict[str, Any] = Field(default_factory=dict)


class ValidateRequest(BaseModel):
    task_data: dict[str, Any] = Field(default_factory=dict)
    entity_ctx: dict[str, Any] = Field(default_factory=dict)


class ValidateResponse(BaseModel):
    is_valid: bool
    is_complete: bool
    field_errors: dict[str, str] = Field(default_factory=dict)
    unmet_requirements: list[str] = Field(default_factory=list)
