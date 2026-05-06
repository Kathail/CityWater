"""Read source paths from linked entities, return a flat seed dict.

The dict mixes top-level columns (e.g. `caller_name`, `asset_id`,
`location`) with `task_data.*` fields. The consuming creator decides
which columns vs. task_data to honour.

Operator overrides take precedence — this function is purely additive,
filling gaps. Callers should merge prefill INTO their dict, not the
other way around.
"""

from __future__ import annotations

from typing import Any

from app.models import Asset, ServiceRequest, TaskDefinition, WorkOrder

# Map source name → attribute getter for each supported path.
_SR_PATHS: dict[str, callable] = {
    "caller_name": lambda sr: sr.caller_name,
    "caller_phone": lambda sr: sr.caller_phone,
    "caller_email": lambda sr: sr.caller_email,
    "reported_address": lambda sr: sr.reported_address,
    "asset_id": lambda sr: sr.asset_id,
    "location": lambda sr: sr.location,
    "description": lambda sr: sr.description,
    "category": lambda sr: sr.category,
    "domain": lambda sr: sr.domain,
    "priority": lambda sr: sr.priority,
}

_ASSET_PATHS: dict[str, callable] = {
    "asset_id": lambda a: a.id,
    "address_cached": lambda a: a.address_cached,
    "class_code": lambda a: a.class_code,
    "material": lambda a: a.material,
    # `coords` is computed; the resolve module knows how to centroid.
    # For prefill we surface the geom as-is; the creator can convert.
    "coords": lambda a: a.geom,
    "geom": lambda a: a.geom,
}

_WO_PATHS: dict[str, callable] = {
    "asset_id": lambda wo: wo.asset_id,
    "location": lambda wo: wo.location,
    "priority": lambda wo: wo.priority,
}


def build_prefill_data(
    *,
    task: TaskDefinition,
    sources: dict[str, Any],
) -> dict:
    """Returns a dict suitable for seeding entity columns and task_data.

    `sources` is a mapping like `{"service_request": sr, "asset": asset}`.
    Missing source keys are skipped silently — that's normal when only
    some links exist.
    """
    out: dict[str, Any] = {}
    rules = task.prefill or {}

    sr = sources.get("service_request")
    if isinstance(sr, ServiceRequest):
        for key in rules.get("from_service_request", []) or []:
            getter = _SR_PATHS.get(key)
            if getter is None:
                continue
            value = getter(sr)
            if value is not None:
                out[key] = value

    asset = sources.get("asset")
    if isinstance(asset, Asset):
        for key in rules.get("from_asset", []) or []:
            getter = _ASSET_PATHS.get(key)
            if getter is None:
                continue
            value = getter(asset)
            if value is not None:
                # Don't overwrite SR-sourced values — SR is closer to the
                # operator's intent than the asset's static metadata.
                out.setdefault(key, value)

    wo = sources.get("work_order")
    if isinstance(wo, WorkOrder):
        for key in rules.get("from_work_order", []) or []:
            getter = _WO_PATHS.get(key)
            if getter is None:
                continue
            value = getter(wo)
            if value is not None:
                out.setdefault(key, value)

    return out
