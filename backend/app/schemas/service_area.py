from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ServiceAreaKind = Literal["maintenance", "water_system", "sewer_system", "storm_system"]


class ServiceAreaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    kind: ServiceAreaKind
    color: str | None = None
    parent_id: int | None = None
    geometry: dict[str, Any] | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ServiceAreaListItem(BaseModel):
    """Trim variant — geometry is optional and often skipped on list pages."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    kind: ServiceAreaKind
    color: str | None = None
    parent_id: int | None = None
    geometry: dict[str, Any] | None = None


class ServiceAreaListResponse(BaseModel):
    items: list[ServiceAreaListItem]


class ServiceAreaCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    kind: ServiceAreaKind
    color: str | None = Field(default=None, max_length=16)
    parent_id: int | None = None
    # Accept any GeoJSON Polygon or MultiPolygon — service stitches a
    # single-polygon input into a MultiPolygon on the way in.
    geometry: dict[str, Any]
    attrs: dict[str, Any] = Field(default_factory=dict)


class ServiceAreaUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: ServiceAreaKind | None = None
    color: str | None = Field(default=None, max_length=16)
    parent_id: int | None = None
    geometry: dict[str, Any] | None = None
    attrs: dict[str, Any] | None = None
