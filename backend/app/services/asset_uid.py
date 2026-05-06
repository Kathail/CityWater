from __future__ import annotations

import re

from sqlalchemy import select

from app.extensions import db
from app.models import Asset

_NUMERIC_SUFFIX = re.compile(r"-(\d+)$")

# Some classes share the same `_MAIN` / `_MH` suffix (water/sewer/storm).
# Disambiguate by domain so MAIN-00001 stays unique across the tenant.
_DOMAIN_PREFIX = {"WAT": "W", "SAN": "S", "STM": "STM"}


def derive_prefix(class_code: str) -> str:
    """`WAT_HYD` → `HYD`. `SAN_MAIN` → `SMAIN` (disambiguated from `WMAIN` /
    `STMMAIN`). `SAN_MH` → `SMH` vs `STMMH`. Single-segment codes return as-is."""
    parts = class_code.split("_", 1)
    if len(parts) != 2:
        return class_code
    domain, suffix = parts
    # Suffixes that can collide across domains get a domain prefix
    if suffix in {"MAIN", "MH"}:
        return f"{_DOMAIN_PREFIX.get(domain, domain)}{suffix}"
    return suffix


def next_asset_uid(*, tenant_id: int, class_code: str) -> str:
    """Compute the next sequential asset_uid for `(tenant, prefix)` of the form
    `{PREFIX}-{NNNNN}`. Searches *all* assets in the tenant with the same
    prefix (not just same class) so we never collide with another class that
    happens to share a suffix. Concurrent writers may still collide on the
    unique constraint; the caller is expected to retry."""
    prefix = derive_prefix(class_code)
    pattern = f"{prefix}-%"
    rows = db.session.scalars(
        select(Asset.asset_uid)
        .where(
            Asset.tenant_id == tenant_id,
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
