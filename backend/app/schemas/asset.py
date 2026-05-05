from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from geojson_pydantic import LineString, Point, Polygon
from pydantic import BaseModel, ConfigDict, Discriminator, Field

GeometryUnion = Annotated[
    Point | LineString | Polygon,
    Discriminator("type"),
]

_AssetStatus = Literal["active", "abandoned", "removed", "proposed"]


class AssetClassRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    domain: str
    name: str
    geometry_type: str
    attribute_schema: dict[str, Any] = Field(default_factory=dict)
    default_criticality: int | None = None
    icon: str | None = None
    color: str | None = None
    is_active: bool


class AssetCreate(BaseModel):
    class_code: str = Field(min_length=1, max_length=32)
    asset_uid: str | None = Field(default=None, min_length=1, max_length=64)
    geometry: GeometryUnion
    install_date: date | None = None
    decommission_date: date | None = None
    material: str | None = Field(default=None, max_length=200)
    diameter_mm: int | None = Field(default=None, ge=0, le=10000)
    length_m: Decimal | None = Field(default=None, ge=0)
    depth_m: Decimal | None = Field(default=None, ge=0)
    manufacturer: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=200)
    warranty_until: date | None = None
    condition: int | None = Field(default=None, ge=1, le=5)
    criticality: int | None = Field(default=None, ge=1, le=5)
    status: _AssetStatus = "active"
    attrs: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None


class AssetUpdate(BaseModel):
    install_date: date | None = None
    decommission_date: date | None = None
    material: str | None = Field(default=None, max_length=200)
    diameter_mm: int | None = Field(default=None, ge=0, le=10000)
    length_m: Decimal | None = Field(default=None, ge=0)
    depth_m: Decimal | None = Field(default=None, ge=0)
    manufacturer: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=200)
    warranty_until: date | None = None
    condition: int | None = Field(default=None, ge=1, le=5)
    criticality: int | None = Field(default=None, ge=1, le=5)
    status: _AssetStatus | None = None
    attrs: dict[str, Any] | None = None
    notes: str | None = None
    geometry: GeometryUnion | None = None


class AssetRead(BaseModel):
    asset_uid: str
    class_code: str
    domain: str
    geometry: dict[str, Any]
    install_date: date | None = None
    decommission_date: date | None = None
    material: str | None = None
    diameter_mm: int | None = None
    length_m: Decimal | None = None
    depth_m: Decimal | None = None
    manufacturer: str | None = None
    model: str | None = None
    serial_number: str | None = None
    warranty_until: date | None = None
    condition: int | None = None
    criticality: int | None = None
    status: str
    attrs: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class AssetListResponse(BaseModel):
    items: list[AssetRead]
    page: int
    page_size: int
    total: int


class AssetHistoryEntry(BaseModel):
    occurred_at: datetime
    action: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    user_uid: str | None = None
    user_full_name: str | None = None


class AssetHistoryResponse(BaseModel):
    items: list[AssetHistoryEntry]
    page: int
    page_size: int
    total: int
