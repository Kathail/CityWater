"""Match a source event/entity to the task definition that handles it.

Iterates active task definitions for the current tenant, returns the
first whose triggers match. A trigger object matches when every key it
declares equals the corresponding value in the payload; missing keys are
wildcards. Ties broken by `task_definition.id` ascending.
"""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import select

from app.extensions import db
from app.models import TaskDefinition

Source = Literal["service_request", "manual", "asset", "work_order"]


def _trigger_matches(trigger: dict[str, Any], source: Source, payload: dict) -> bool:
    if trigger.get("from") != source:
        return False
    for key, expected in trigger.items():
        if key == "from":
            continue
        if payload.get(key) != expected:
            return False
    return True


def find_matching_task(
    *,
    tenant_id: int,
    source: Source,
    payload: dict,
) -> TaskDefinition | None:
    rows = db.session.scalars(
        select(TaskDefinition)
        .where(
            TaskDefinition.tenant_id == tenant_id,
            TaskDefinition.status == "active",
            TaskDefinition.deleted_at.is_(None),
        )
        .order_by(TaskDefinition.id.asc())
    ).all()
    for td in rows:
        for trigger in td.triggers or []:
            if _trigger_matches(trigger, source, payload):
                return td
    return None
