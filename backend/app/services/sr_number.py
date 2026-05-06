from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import select

from app.extensions import db
from app.models import ServiceRequest

_SUFFIX = re.compile(r"-(\d+)$")


def next_sr_number(tenant_id: int) -> str:
    """`SR-YYYY-NNNNN` per (tenant, year). Sequence resets each year."""
    year = datetime.now(UTC).year
    prefix = f"SR-{year}-"
    rows = db.session.scalars(
        select(ServiceRequest.sr_number)
        .where(
            ServiceRequest.tenant_id == tenant_id,
            ServiceRequest.sr_number.like(f"{prefix}%"),
        )
        .execution_options(skip_tenant_filter=True, include_deleted=True)
    ).all()
    max_num = 0
    for n in rows:
        m = _SUFFIX.search(n)
        if m:
            v = int(m.group(1))
            if v > max_num:
                max_num = v
    return f"{prefix}{max_num + 1:05d}"
