from __future__ import annotations

from typing import Any

import jsonschema

from app.errors import ValidationError
from app.models import AssetClass


def validate_attrs_against_class(attrs: dict[str, Any], asset_class: AssetClass) -> None:
    """Validate `attrs` against `asset_class.attribute_schema` (a JSON Schema doc).
    Empty schema accepts anything."""
    schema = asset_class.attribute_schema or {}
    if not schema:
        return
    try:
        jsonschema.validate(attrs, schema)
    except jsonschema.ValidationError as exc:
        raise ValidationError(
            f"attrs failed schema validation: {exc.message}",
            code="attrs_invalid",
        ) from exc
