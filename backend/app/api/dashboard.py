"""Dashboard aggregation endpoint.

One round-trip per home-screen load. Caller gets KPIs, today's queue,
recent activity, and a couple of charts ready to render. Tenant filter
is applied via the session listener; everything below scopes naturally.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from flask import Blueprint, jsonify
from flask_login import current_user, login_required
from sqlalchemy import desc, func, or_, select

from app.extensions import db
from app.models import (
    Asset,
    AuditLog,
    Comment,
    Inspection,
    ServiceArea,
    ServiceRequest,
    WorkOrder,
    WorkOrderAsset,
    WorkOrderTimeLog,
)

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/v1/dashboard")

# Single source of truth for "WO is still alive" — matches the list
# page's `?scope=active` filter (work_orders.py:306) so the dashboard's
# `open` KPI lands on a list whose total count matches the tile.
# `on_hold` counts: a paused WO is still work the team owns.
_WO_OPEN_STATUSES: tuple[str, ...] = ("open", "assigned", "in_progress", "on_hold")


@dashboard_bp.get("")
@login_required
def get_dashboard():
    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    payload: dict[str, Any] = {
        "wo_kpis": _wo_kpis(now, week_ago, month_ago),
        "sr_kpis": _sr_kpis(week_ago, month_ago),
        "today_queue": _today_queue(today_start, now),
        "recent_activity": _recent_activity(now - timedelta(days=2)),
        "wo_by_category_30d": _wo_by_category(month_ago),
        "sr_by_priority_30d": _sr_by_priority(month_ago),
        "throughput_7d": _throughput_7d(week_ago, now),
        "by_area": _by_area(now),
    }
    return jsonify(payload)


# ---------- KPI builders ----------


def _wo_kpis(now: datetime, week_ago: datetime, month_ago: datetime) -> dict[str, Any]:
    """All WO counts collapsed into two aggregates.

    Was 8 separate SELECT count() round-trips; the polling dashboard
    fired all 8 every 60s. Postgres FILTER (WHERE …) lets us compute
    every count in a single scan of the workorder table. Keeps the
    dashboard tight under load.
    """
    sched = func.coalesce(WorkOrder.scheduled_for, WorkOrder.created_at)
    started = func.coalesce(WorkOrder.started_at, WorkOrder.scheduled_for)
    is_open = WorkOrder.status.in_(_WO_OPEN_STATUSES)
    # `count(*) FILTER (WHERE …)` is the standard SQL idiom; SQLAlchemy
    # exposes it via `func.count().filter(…)`.
    #
    # `select_from(WorkOrder)` is required for the tenant listener:
    # `_apply_tenant_filter` uses `with_loader_criteria(WorkOrder, …)`,
    # which only attaches criteria when the class is referenced as an
    # entity in the SELECT/FROM. Without this, FILTER aggregates over
    # WorkOrder columns slip past the listener and count cross-tenant
    # rows. test_dashboard_is_tenant_scoped catches the regression.
    row = db.session.execute(
        select(
            func.count().filter(is_open).label("open"),
            func.count().filter(WorkOrder.status == "in_progress").label("in_progress"),
            func.count()
            .filter(is_open, WorkOrder.due_by < now)
            .label("overdue"),
            func.count().filter(is_open, sched < month_ago).label("stale_open"),
            func.count()
            .filter(WorkOrder.status == "completed", WorkOrder.completed_at >= week_ago)
            .label("completed_week"),
            func.count().filter(sched >= month_ago).label("scheduled_30d"),
            func.count()
            .filter(WorkOrder.status == "completed", WorkOrder.completed_at >= month_ago)
            .label("completed_30d"),
            # Average completion time: started → completed, only when
            # both are present and ordered correctly. The same FILTER
            # pattern keeps it in the single round-trip.
            func.avg(func.extract("epoch", WorkOrder.completed_at - started) / 3600.0)
            .filter(
                WorkOrder.status == "completed",
                WorkOrder.completed_at >= month_ago,
                WorkOrder.completed_at.isnot(None),
                started.isnot(None),
                WorkOrder.completed_at >= started,
            )
            .label("avg_close_hours"),
        ).select_from(WorkOrder)
    ).one()

    stops_completed_week = (
        db.session.scalar(
            select(func.count()).select_from(WorkOrderAsset).where(WorkOrderAsset.completed_at >= week_ago)
        )
        or 0
    )
    hours_week = (
        db.session.scalar(
            select(func.coalesce(func.sum(WorkOrderTimeLog.hours_decimal), 0)).where(
                WorkOrderTimeLog.started_at >= week_ago
            )
        )
        or 0
    )

    completion_rate = round(row.completed_30d / row.scheduled_30d, 2) if row.scheduled_30d else None
    return {
        "open": int(row.open or 0),
        "in_progress": int(row.in_progress or 0),
        "overdue": int(row.overdue or 0),
        "stale_open": int(row.stale_open or 0),
        "completed_this_week": int(row.completed_week or 0),
        "stops_completed_this_week": int(stops_completed_week),
        "hours_this_week": float(hours_week),
        "completion_rate_30d": completion_rate,
        "avg_close_hours_30d": (
            round(float(row.avg_close_hours), 1) if row.avg_close_hours is not None else None
        ),
    }


def _sr_kpis(week_ago: datetime, month_ago: datetime) -> dict[str, Any]:
    """All SR counts in one round-trip via FILTER aggregates.

    `closed_this_week` excludes "duplicate" so it agrees with
    `avg_resolution_hours_30d`; both metrics read "actual dispatch /
    resolution work," not "anything that left the inbox." DASH-P1-3.
    """
    # select_from(ServiceRequest) is required for the tenant listener
    # to scope FILTER aggregates — see the parallel comment in _wo_kpis.
    row = db.session.execute(
        select(
            func.count().filter(ServiceRequest.status == "new").label("new"),
            func.count().filter(ServiceRequest.status == "triaged").label("triaged"),
            func.count().filter(ServiceRequest.status == "dispatched").label("dispatched"),
            func.count()
            .filter(ServiceRequest.status == "closed", ServiceRequest.closed_at >= week_ago)
            .label("closed_week"),
            func.avg(
                func.extract("epoch", ServiceRequest.closed_at - ServiceRequest.reported_at) / 3600.0
            )
            .filter(
                ServiceRequest.status == "closed",
                ServiceRequest.closed_at >= month_ago,
                ServiceRequest.closed_at.isnot(None),
            )
            .label("avg_resolution_hours"),
        ).select_from(ServiceRequest)
    ).one()
    return {
        "new": int(row.new or 0),
        "triaged": int(row.triaged or 0),
        "dispatched": int(row.dispatched or 0),
        "closed_this_week": int(row.closed_week or 0),
        "avg_resolution_hours_30d": (
            round(float(row.avg_resolution_hours), 1)
            if row.avg_resolution_hours is not None
            else None
        ),
    }


def _today_queue(today_start: datetime, now: datetime) -> list[dict[str, Any]]:
    """WOs assigned to *me* that are scheduled for today or already in
    progress / on hold / overdue. Capped at 8 to keep the panel tight."""
    today_end = today_start + timedelta(days=1)
    rows = db.session.scalars(
        select(WorkOrder)
        .where(
            WorkOrder.assigned_to == current_user.id,
            WorkOrder.status.in_(("assigned", "in_progress", "on_hold")),
            or_(
                WorkOrder.scheduled_for.is_(None),
                WorkOrder.scheduled_for < today_end,
            ),
        )
        .order_by(WorkOrder.scheduled_for.asc().nullslast(), WorkOrder.id.asc())
        .limit(8)
    ).all()
    if not rows:
        return []

    # One GROUP BY query for all queue rows — was 2 count queries per
    # row (16 round-trips for an 8-row queue) before DASH-P1-5.
    # func.count(col) skips nulls so completed_at IS NOT NULL is the
    # natural "done" count — no separate filter needed.
    wo_ids = [wo.id for wo in rows]
    by_wo: dict[int, tuple[int, int]] = {}
    for wo_id, total, done in db.session.execute(
        select(
            WorkOrderAsset.work_order_id,
            func.count().label("total"),
            func.count(WorkOrderAsset.completed_at).label("done"),
        )
        .where(WorkOrderAsset.work_order_id.in_(wo_ids))
        .group_by(WorkOrderAsset.work_order_id)
    ).all():
        by_wo[wo_id] = (int(total), int(done))

    out: list[dict[str, Any]] = []
    for wo in rows:
        total, done = by_wo.get(wo.id, (0, 0))
        out.append(
            {
                "wo_number": wo.wo_number,
                "title": wo.title,
                "category": wo.category,
                "priority": wo.priority,
                "status": wo.status,
                "scheduled_for": wo.scheduled_for.isoformat() if wo.scheduled_for else None,
                "due_by": wo.due_by.isoformat() if wo.due_by else None,
                "is_overdue": bool(wo.due_by and wo.due_by < now),
                "asset_total": total,
                "asset_done": done,
            }
        )
    return out


_ACTIVITY_LIMIT = 12
# Per-stream cap before merging. With 8 of each, a chatty comment burst
# can't fully starve status transitions — both signal types stay visible.
_ACTIVITY_PER_STREAM = 8


def _recent_activity(since: datetime) -> list[dict[str, Any]]:
    """Recent comments + status transitions across the tenant — last 48h,
    capped at `_ACTIVITY_LIMIT`. Each stream is capped at
    `_ACTIVITY_PER_STREAM` BEFORE the merge so a flood of comments can't
    push every transition off the panel.

    Each row carries the entity's human-readable code (`wo_number` /
    `sr_number` / `inspection_number`) when available, so the frontend
    can deep-link to the entity's detail page rather than the list.
    Internal numeric ids are excluded from the response per CLAUDE.md
    "no internal IDs in URLs."
    """
    comment_rows = (
        db.session.execute(
            select(Comment)
            .where(Comment.created_at >= since)
            .order_by(desc(Comment.created_at))
            .limit(_ACTIVITY_PER_STREAM)
        )
        .scalars()
        .all()
    )
    # AuditLog isn't TenantScopedMixin — must filter explicitly so the
    # session listener doesn't accidentally let cross-tenant rows through.
    audit_rows = (
        db.session.execute(
            select(AuditLog)
            .where(
                AuditLog.tenant_id == current_user.tenant_id,
                AuditLog.occurred_at >= since,
                AuditLog.action.in_(("wo_transition", "sr_transition", "sr_dispatch")),
            )
            .order_by(desc(AuditLog.occurred_at))
            .limit(_ACTIVITY_PER_STREAM)
        )
        .scalars()
        .all()
    )

    # Resolve internal entity_ids → human codes in batched lookups
    # (one query per entity type, regardless of row count).
    code_lookup = _activity_code_lookup(comment_rows, audit_rows)

    items: list[dict[str, Any]] = []
    for c in comment_rows:
        items.append(
            {
                "kind": "comment",
                "occurred_at": c.created_at.isoformat(),
                "entity_type": c.entity_type,
                "entity_code": code_lookup.get((c.entity_type, c.entity_id)),
                "summary": c.body[:140],
            }
        )
    for ev in audit_rows:
        before = (ev.before or {}).get("status") if isinstance(ev.before, dict) else None
        after = (ev.after or {}).get("status") if isinstance(ev.after, dict) else None
        items.append(
            {
                "kind": "transition",
                "occurred_at": ev.occurred_at.isoformat(),
                "entity_type": ev.entity_type,
                "entity_code": code_lookup.get((ev.entity_type, ev.entity_id)),
                "summary": (f"{before} → {after}" if before and after else ev.action),
            }
        )
    items.sort(key=lambda x: x["occurred_at"], reverse=True)
    return items[:_ACTIVITY_LIMIT]


def _activity_code_lookup(comment_rows, audit_rows) -> dict[tuple[str, int], str]:
    """Batch-resolve (entity_type, entity_id) → human code for every
    activity row. One SELECT per entity type, regardless of row count.
    Tenant scoping comes from the session listener (all three are
    TenantScopedMixin)."""
    by_type: dict[str, set[int]] = {}
    for r in (*comment_rows, *audit_rows):
        by_type.setdefault(r.entity_type, set()).add(r.entity_id)

    out: dict[tuple[str, int], str] = {}

    if "work_order" in by_type:
        rows = db.session.execute(
            select(WorkOrder.id, WorkOrder.wo_number).where(WorkOrder.id.in_(by_type["work_order"]))
        ).all()
        for wo_id, code in rows:
            out[("work_order", wo_id)] = code
    if "service_request" in by_type:
        rows = db.session.execute(
            select(ServiceRequest.id, ServiceRequest.sr_number).where(
                ServiceRequest.id.in_(by_type["service_request"])
            )
        ).all()
        for sr_id, code in rows:
            out[("service_request", sr_id)] = code
    if "inspection" in by_type:
        rows = db.session.execute(
            select(Inspection.id, Inspection.inspection_number).where(
                Inspection.id.in_(by_type["inspection"])
            )
        ).all()
        for ins_id, code in rows:
            out[("inspection", ins_id)] = code

    return out


def _wo_by_category(since: datetime) -> list[dict[str, Any]]:
    rows = db.session.execute(
        select(WorkOrder.category, func.count().label("n"))
        .where(WorkOrder.created_at >= since)
        .group_by(WorkOrder.category)
        .order_by(desc("n"))
    ).all()
    return [{"category": r[0], "count": int(r[1])} for r in rows]


def _sr_by_priority(since: datetime) -> list[dict[str, Any]]:
    rows = db.session.execute(
        select(ServiceRequest.priority, func.count().label("n"))
        .where(ServiceRequest.reported_at >= since)
        .group_by(ServiceRequest.priority)
    ).all()
    # Stable order for display
    order = {"emergency": 0, "high": 1, "normal": 2, "low": 3}
    return sorted(
        [{"priority": r[0], "count": int(r[1])} for r in rows],
        key=lambda x: order.get(x["priority"], 99),
    )


def _by_area(now: datetime) -> list[dict[str, Any]]:
    """Per service area: active WOs, overdue WOs, and active SRs.

    An entity belongs to an area when its linked asset's geom intersects
    the area's polygon. This is read-time spatial — fine for tenants
    with hundreds of areas + thousands of active items; switch to a
    materialized join later if it ever becomes the bottleneck.

    Within a kind, an entity counts once even if its asset's geom
    intersects multiple polygons (e.g. two overlapping water systems);
    the entity is assigned to the smallest enclosing area in that kind.
    Across kinds an entity can still appear in multiple rows (a
    maintenance district + a water system are different concepts) — the
    panel surfaces that explicitly so the supervisor doesn't try to add
    rows up to the headline KPI.
    """
    WO_ACTIVE = _WO_OPEN_STATUSES
    SR_ACTIVE = ("new", "triaged", "dispatched")

    # Smallest-area-wins assignment: for each entity, within each kind
    # of service area, pick the area whose polygon has the smallest
    # ST_Area. DISTINCT ON gives one row per (entity, kind), which we
    # then group on the area side to count.
    #
    # The Asset join is shared between the WO and SR variants; only the
    # outer entity table differs.
    def _assigned_areas(entity_table, status_col, statuses, *extra_filters):
        ranked = (
            select(
                entity_table.id.label("entity_id"),
                ServiceArea.kind.label("kind"),
                ServiceArea.id.label("area_id"),
            )
            .select_from(entity_table)
            .join(Asset, entity_table.asset_id == Asset.id)
            .join(ServiceArea, func.ST_Intersects(ServiceArea.geom, Asset.geom))
            .where(status_col.in_(statuses))
            .where(ServiceArea.deleted_at.is_(None))
            .order_by(
                entity_table.id,
                ServiceArea.kind,
                func.ST_Area(ServiceArea.geom).asc(),
            )
            .distinct(entity_table.id, ServiceArea.kind)
        )
        for f in extra_filters:
            ranked = ranked.where(f)
        sub = ranked.subquery()
        rows = db.session.execute(
            select(sub.c.area_id, func.count().label("n")).group_by(sub.c.area_id)
        ).all()
        return {int(r.area_id): int(r.n) for r in rows}

    wo_by_area = _assigned_areas(WorkOrder, WorkOrder.status, WO_ACTIVE)
    overdue_by_area = _assigned_areas(WorkOrder, WorkOrder.status, WO_ACTIVE, WorkOrder.due_by < now)
    sr_by_area = _assigned_areas(ServiceRequest, ServiceRequest.status, SR_ACTIVE)

    # Hydrate the area metadata + counts.
    areas = db.session.scalars(
        select(ServiceArea).where(ServiceArea.deleted_at.is_(None)).order_by(ServiceArea.kind, ServiceArea.name)
    ).all()
    return [
        {
            "id": a.id,
            "code": a.code,
            "name": a.name,
            "kind": a.kind,
            "color": a.color,
            "active_wos": wo_by_area.get(a.id, 0),
            "overdue_wos": overdue_by_area.get(a.id, 0),
            "active_srs": sr_by_area.get(a.id, 0),
        }
        for a in areas
    ]


def _throughput_7d(week_ago: datetime, now: datetime) -> list[dict[str, Any]]:
    """7-day completion bucket for the sparkline-like trend in the KPI
    strip. One bucket per day, oldest first.

    DASH-P1-6: was 7 separate count queries; now one date_trunc GROUP BY
    that returns at most 7 rows. Days with zero completions are filled
    in by the Python-side bucket walk so the sparkline always has 7
    bars regardless of activity.
    """
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    seven_days_ago = today_start - timedelta(days=6)
    rows = db.session.execute(
        select(
            func.date_trunc("day", WorkOrder.completed_at).label("day"),
            func.count().label("n"),
        )
        .where(
            WorkOrder.status == "completed",
            WorkOrder.completed_at >= seven_days_ago,
            WorkOrder.completed_at < today_start + timedelta(days=1),
        )
        .group_by("day")
    ).all()
    counts: dict[str, int] = {}
    for day, n in rows:
        counts[day.date().isoformat()] = int(n)

    out: list[dict[str, Any]] = []
    for i in range(6, -1, -1):
        day_start = today_start - timedelta(days=i)
        key = day_start.date().isoformat()
        out.append({"date": key, "completed": counts.get(key, 0)})
    return out
