"""Evaluate a task's spawn rules; create follow-up entities.

Called when an entity transitions to `completed`. Each spawn fires
synchronously and creates an immediate child of the spec'd type. The
spec's `schedule` (e.g. `+24h`) is logged as a TODO for now — deferred
spawning lands in a follow-up PR with RQ. We create the entity
immediately and record a warning so the operator sees the slip.

Missing target tasks (`task` not seeded yet) → log a warning, create a
generic entity without a `task_definition_id`, never crash.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select

from app.extensions import db
from app.models import Inspection, ServiceRequest, TaskDefinition, WorkOrder
from app.services.expr import safe_evaluate
from app.services.inspection_number import next_inspection_number
from app.services.sr_number import next_sr_number
from app.services.wo_number import next_wo_number

logger = logging.getLogger(__name__)


def _resolve_task(*, tenant_id: int, code: str) -> TaskDefinition | None:
    return db.session.scalar(
        select(TaskDefinition).where(
            TaskDefinition.tenant_id == tenant_id,
            TaskDefinition.code == code,
            TaskDefinition.status == "active",
            TaskDefinition.deleted_at.is_(None),
        )
    )


def _create_spawn(
    *,
    parent: WorkOrder | ServiceRequest | Inspection,
    target: TaskDefinition | None,
    spec: dict[str, Any],
) -> WorkOrder | ServiceRequest | Inspection:
    produces = target.produces if target else "work_order"
    priority = spec.get("priority") or (target.default_priority if target else None) or "normal"

    asset_id = getattr(parent, "asset_id", None)
    location = getattr(parent, "location", None)

    if produces == "work_order":
        n = next_wo_number(tenant_id=parent.tenant_id)
        parent_ref = (
            getattr(parent, "wo_number", None)
            or getattr(parent, "sr_number", None)
            or getattr(parent, "inspection_number", None)
            or ""
        )
        title = target.title if target else f"Follow-up to {parent_ref}"
        category = spec.get("category") or (target.default_category if target else None) or "other"
        wo = WorkOrder(
            tenant_id=parent.tenant_id,
            wo_number=n,
            type="planned",
            category=category,
            priority=priority,
            status="open",
            title=title,
            asset_id=asset_id,
            location=location,
            task_definition_id=target.id if target else None,
        )
        db.session.add(wo)
        db.session.flush()
        return wo

    if produces == "inspection":
        n = next_inspection_number(tenant_id=parent.tenant_id)
        kind = spec.get("kind") or (target.default_category if target else "manhole")
        from datetime import UTC, datetime

        ins = Inspection(
            tenant_id=parent.tenant_id,
            inspection_number=n,
            kind=kind,
            asset_id=asset_id,
            performed_at=datetime.now(UTC),
            data={},
            task_definition_id=target.id if target else None,
        )
        db.session.add(ins)
        db.session.flush()
        return ins

    if produces == "service_request":
        from datetime import UTC, datetime

        n = next_sr_number(tenant_id=parent.tenant_id)
        sr = ServiceRequest(
            tenant_id=parent.tenant_id,
            sr_number=n,
            category=spec.get("category") or "other",
            domain=spec.get("domain") or "water",
            priority=priority,
            status="new",
            reported_at=datetime.now(UTC),
            asset_id=asset_id,
            location=location,
            task_definition_id=target.id if target else None,
        )
        db.session.add(sr)
        db.session.flush()
        return sr

    raise ValueError(f"unknown produces type {produces!r}")


def evaluate_spawns(
    *,
    task: TaskDefinition,
    parent_entity: WorkOrder | ServiceRequest | Inspection,
    task_data: dict,
) -> list[WorkOrder | ServiceRequest | Inspection]:
    """Returns the list of spawned entities (may be empty)."""
    out: list[WorkOrder | ServiceRequest | Inspection] = []
    for spec in task.spawns or []:
        when = spec.get("when")
        if when and not safe_evaluate(when, task_data, default=False):
            continue

        target_code = spec.get("task")
        target: TaskDefinition | None = None
        if target_code:
            target = _resolve_task(tenant_id=parent_entity.tenant_id, code=target_code)
            if target is None:
                logger.warning(
                    "spawn target task %r not found for tenant %s — creating "
                    "generic entity without a task_definition_id",
                    target_code,
                    parent_entity.tenant_id,
                )

        if spec.get("schedule"):
            logger.warning(
                "spawn schedule=%s requested but deferred scheduling isn't "
                "implemented yet; creating immediately (TODO: queue via RQ)",
                spec["schedule"],
            )

        spawned = _create_spawn(parent=parent_entity, target=target, spec=spec)
        out.append(spawned)
    return out
