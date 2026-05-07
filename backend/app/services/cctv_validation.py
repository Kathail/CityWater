from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.errors import ValidationError
from app.extensions import db
from app.models.pacp_code import PacpCode
from app.schemas.cctv import CctvData


def _known_codes() -> set[str]:
    rows = db.session.scalars(
        select(PacpCode.code).where(PacpCode.is_active.is_(True)).execution_options(skip_tenant_filter=True)
    ).all()
    return set(rows)


def validate_cctv(data: dict[str, Any]) -> dict[str, Any]:
    """Pydantic-validate the survey envelope, then enforce two cross-cutting
    rules from §3.6 / Epic 4: every observation code must be in pacp_code,
    and distance_m must be ≤ length_surveyed_m."""
    try:
        validated = CctvData.model_validate(data)
    except Exception as e:
        raise ValidationError(str(e), code="invalid_data") from e

    codes = _known_codes()
    bad_codes: list[tuple[int, str]] = []
    for idx, obs in enumerate(validated.observations):
        if obs.code not in codes:
            bad_codes.append((idx, obs.code))
    if bad_codes:
        offenders = ", ".join(f"obs[{i}]={c!r}" for i, c in bad_codes)
        raise ValidationError(f"unknown PACP code(s): {offenders}", code="unknown_pacp_code")

    if validated.length_surveyed_m is not None:
        max_d = validated.length_surveyed_m
        for idx, obs in enumerate(validated.observations):
            if obs.distance_m > max_d:
                raise ValidationError(
                    (f"observation[{idx}].distance_m ({obs.distance_m}) exceeds length_surveyed_m ({max_d})"),
                    code="distance_exceeds_length",
                )

    return _serialize(validated)


def _serialize(model: CctvData) -> dict[str, Any]:
    """Pydantic by_alias dump with Decimal → string for JSONB-safe storage."""
    raw = model.model_dump(mode="json")
    # Decimals already serialized as strings by mode=json
    return raw


def derive_pass(structural_qr: int | None, om_qr: int | None) -> bool | None:
    """Convention: pass if both ratings ≤ 3 (when supplied). None otherwise."""
    if structural_qr is None and om_qr is None:
        return None
    return all(r is None or r <= 3 for r in (structural_qr, om_qr) if r is not None)
