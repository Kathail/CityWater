from __future__ import annotations

import re

from sqlalchemy import select

from app.extensions import db
from app.models import Asset

_NUMERIC_SUFFIX = re.compile(r"-(\d+)$")


def derive_prefix(class_code: str) -> str:
    """`WAT_HYD` → `HYD`. `SAN_MH` → `MH`. Single-segment codes are returned as-is."""
    parts = class_code.split("_", 1)
    return parts[1] if len(parts) > 1 else class_code


def next_asset_uid(*, tenant_id: int, class_code: str) -> str:
    """Compute the next sequential asset_uid for `(tenant, class)` of the form
    `{PREFIX}-{NNNNN}`. Reads existing uids; concurrent writers may collide on
    the unique constraint and the caller is expected to retry."""
    prefix = derive_prefix(class_code)
    pattern = f"{prefix}-%"
    rows = db.session.scalars(
        select(Asset.asset_uid)
        .where(
            Asset.tenant_id == tenant_id,
            Asset.class_code == class_code,
            Asset.asset_uid.like(pattern),
        )
        .execution_options(skip_tenant_filter=True, include_deleted=True)
    ).all()

    max_num = 0
    for uid in rows:
        match = _NUMERIC_SUFFIX.search(uid)
        if match:
            n = int(match.group(1))
            if n > max_num:
                max_num = n

    return f"{prefix}-{max_num + 1:05d}"
