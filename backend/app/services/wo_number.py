from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import select

from app.extensions import db
from app.models import WorkOrder

_SUFFIX = re.compile(r"-(\d+)$")


def next_wo_number(tenant_id: int) -> str:
    """`WO-YYYY-NNNNN` per (tenant, year). Sequence resets each year."""
    year = datetime.now(UTC).year
    prefix = f"WO-{year}-"
    rows = db.session.scalars(
        select(WorkOrder.wo_number)
        .where(
            WorkOrder.tenant_id == tenant_id,
            WorkOrder.wo_number.like(f"{prefix}%"),
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
