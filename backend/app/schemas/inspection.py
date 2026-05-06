from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

InspectionKind = Literal[
    "cctv",
    "hydrant_flow",
    "valve_exercise",
    "manhole",
    "catch_basin",
    "lift_station_round",
]


# --- Per-kind data shapes (validated server-side per kind) ---


class HydrantFlowData(BaseModel):
    static_psi: int = Field(ge=0, le=300)
    residual_psi: int = Field(ge=0, le=300)
    flow_gpm: int = Field(ge=0, le=10000)
    pitot_psi: int | None = Field(default=None, ge=0, le=300)
    outlet_size_mm: int | None = Field(default=None, ge=0, le=1000)
    coefficient: float | None = Field(default=None, ge=0, le=1)
    # Server-computed; clients providing them is silently overridden
    calc_gpm_at_20psi: int | None = None
    color_class: Literal["blue", "green", "orange", "red"] | None = None


class ValveExerciseData(BaseModel):
    turns_to_close: int = Field(ge=0, le=200)
    expected_turns: int | None = Field(default=None, ge=0, le=200)
    operates: bool
    leaks: bool = False
    torque_excessive: bool = False
    lubricated: bool = False


class ManholeData(BaseModel):
    frame_cover_condition: int = Field(ge=1, le=5)
    chimney_condition: int = Field(ge=1, le=5)
    cone_condition: int = Field(ge=1, le=5)
    wall_condition: int = Field(ge=1, le=5)
    bench_channel_condition: int = Field(ge=1, le=5)
    infiltration_lpm: Decimal | None = Field(default=None, ge=0)
    depth_m: Decimal | None = Field(default=None, ge=0)
    h2s_ppm: int | None = Field(default=None, ge=0)


class CatchBasinData(BaseModel):
    grate_condition: int = Field(ge=1, le=5)
    sump_depth_m: Decimal | None = Field(default=None, ge=0)
    sediment_depth_m: Decimal | None = Field(default=None, ge=0)
    needs_cleaning: bool
    blockage: bool = False


class LiftStationData(BaseModel):
    wet_well_level_m: Decimal | None = Field(default=None, ge=0)
    pump1_runtime_h: Decimal | None = Field(default=None, ge=0)
    pump2_runtime_h: Decimal | None = Field(default=None, ge=0)
    pump1_amps: Decimal | None = Field(default=None, ge=0)
    pump2_amps: Decimal | None = Field(default=None, ge=0)
    alarms: list[str] = Field(default_factory=list)
    generator_test_pass: bool | None = None
    odour_pass: bool | None = None


# Map kind → data schema. CCTV is intentionally absent (S7).
KIND_DATA_SCHEMA: dict[str, type[BaseModel]] = {
    "hydrant_flow": HydrantFlowData,
    "valve_exercise": ValveExerciseData,
    "manhole": ManholeData,
    "catch_basin": CatchBasinData,
    "lift_station_round": LiftStationData,
}


# --- Inspection envelope ---


class InspectionCreate(BaseModel):
    kind: InspectionKind
    asset_uid: str | None = None
    work_order_number: str | None = None
    performed_at: datetime
    overall_condition: int | None = Field(default=None, ge=1, le=5)
    pass_: bool | None = Field(default=None, alias="pass")
    notes: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    attrs: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)


class InspectionUpdate(BaseModel):
    performed_at: datetime | None = None
    overall_condition: int | None = Field(default=None, ge=1, le=5)
    pass_: bool | None = Field(default=None, alias="pass")
    notes: str | None = None
    data: dict[str, Any] | None = None

    model_config = ConfigDict(populate_by_name=True)


class InspectionRead(BaseModel):
    inspection_number: str
    kind: InspectionKind
    asset_uid: str | None = None
    work_order_number: str | None = None
    performed_at: datetime
    performed_by: int | None = None
    overall_condition: int | None = None
    pass_: bool | None = Field(default=None, alias="pass")
    notes: str | None = None
    data: dict[str, Any]
    attrs: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(populate_by_name=True)


class InspectionListResponse(BaseModel):
    items: list[InspectionRead]
    page: int
    page_size: int
    total: int
