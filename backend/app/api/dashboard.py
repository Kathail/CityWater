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
    AuditLog,
    Comment,
    ServiceRequest,
    WorkOrder,
    WorkOrderAsset,
    WorkOrderTimeLog,
)

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/v1/dashboard")


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
    }
    return jsonify(payload)


# ---------- KPI builders ----------


def _wo_kpis(now: datetime, week_ago: datetime, month_ago: datetime) -> dict[str, Any]:
    open_count = db.session.scalar(
        select(func.count())
        .select_from(WorkOrder)
        .where(WorkOrder.status.in_(("open", "assigned", "in_progress")))
    ) or 0
    in_progress = db.session.scalar(
        select(func.count())
        .select_from(WorkOrder)
        .where(WorkOrder.status == "in_progress")
    ) or 0
    overdue = db.session.scalar(
        select(func.count())
        .select_from(WorkOrder)
        .where(
            WorkOrder.due_by < now,
            WorkOrder.status.in_(("open", "assigned", "in_progress")),
        )
    ) or 0
    completed_week = db.session.scalar(
        select(func.count())
        .select_from(WorkOrder)
        .where(
            WorkOrder.status == "completed",
            WorkOrder.completed_at >= week_ago,
        )
    ) or 0
    stops_completed_week = db.session.scalar(
        select(func.count())
        .select_from(WorkOrderAsset)
        .where(WorkOrderAsset.completed_at >= week_ago)
    ) or 0
    hours_week = db.session.scalar(
        select(func.coalesce(func.sum(WorkOrderTimeLog.hours_decimal), 0))
        .where(WorkOrderTimeLog.started_at >= week_ago)
    ) or 0
    # Backlog: open WOs scheduled more than 30 days ago that are still
    # open. Use scheduled_for (operational time) rather than created_at
    # (intake time) — same reasoning as avg_close_hours below.
    sched = func.coalesce(WorkOrder.scheduled_for, WorkOrder.created_at)
    stale_open = db.session.scalar(
        select(func.count())
        .select_from(WorkOrder)
        .where(
            WorkOrder.status.in_(("open", "assigned", "in_progress", "on_hold")),
            sched < month_ago,
        )
    ) or 0
    # Completion rate: completed in last 30d / scheduled in last 30d. A
    # ratio supervisors recognise immediately (>1.0 = burning down,
    # <1.0 = backlog growing).
    scheduled_30d = db.session.scalar(
        select(func.count())
        .select_from(WorkOrder)
        .where(sched >= month_ago)
    ) or 0
    completed_30d = db.session.scalar(
        select(func.count())
        .select_from(WorkOrder)
        .where(
            WorkOrder.status == "completed",
            WorkOrder.completed_at >= month_ago,
        )
    ) or 0
    completion_rate = (
        round(completed_30d / scheduled_30d, 2) if scheduled_30d else None
    )
    # Average completion time in hours for WOs closed last 30d. Measure
    # operational duration (started → completed); fall back to scheduled
    # → completed when started_at isn't recorded. Avoids using created_at
    # which reflects the row's intake time, not work time.
    started = func.coalesce(WorkOrder.started_at, WorkOrder.scheduled_for)
    avg_close_hours = db.session.scalar(
        select(
            func.avg(
                func.extract("epoch", WorkOrder.completed_at - started) / 3600.0
            )
        ).where(
            WorkOrder.status == "completed",
            WorkOrder.completed_at >= month_ago,
            WorkOrder.completed_at.isnot(None),
            started.isnot(None),
            WorkOrder.completed_at >= started,
        )
    )
    return {
        "open": int(open_count),
        "in_progress": int(in_progress),
        "overdue": int(overdue),
        "stale_open": int(stale_open),
        "completed_this_week": int(completed_week),
        "stops_completed_this_week": int(stops_completed_week),
        "hours_this_week": float(hours_week),
        "completion_rate_30d": completion_rate,
        "avg_close_hours_30d": (
            round(float(avg_close_hours), 1) if avg_close_hours is not None else None
        ),
    }


def _sr_kpis(week_ago: datetime, month_ago: datetime) -> dict[str, Any]:
    new_count = db.session.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(ServiceRequest.status == "new")
    ) or 0
    triaged = db.session.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(ServiceRequest.status == "triaged")
    ) or 0
    dispatched = db.session.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(ServiceRequest.status == "dispatched")
    ) or 0
    closed_week = db.session.scalar(
        select(func.count())
        .select_from(ServiceRequest)
        .where(
            ServiceRequest.status.in_(("closed", "duplicate")),
            ServiceRequest.closed_at >= week_ago,
        )
    ) or 0
    # Average resolution time (hours) for SRs closed in the last 30d.
    # Excludes duplicates so the metric reflects actual dispatch work.
    avg_resolution_hours = db.session.scalar(
        select(
            func.avg(
                func.extract("epoch", ServiceRequest.closed_at - ServiceRequest.reported_at)
                / 3600.0
            )
        ).where(
            ServiceRequest.status == "closed",
            ServiceRequest.closed_at >= month_ago,
            ServiceRequest.closed_at.isnot(None),
        )
    )
    return {
        "new": int(new_count),
        "triaged": int(triaged),
        "dispatched": int(dispatched),
        "closed_this_week": int(closed_week),
        "avg_resolution_hours_30d": (
            round(float(avg_resolution_hours), 1)
            if avg_resolution_hours is not None
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
    out: list[dict[str, Any]] = []
    for wo in rows:
        total = db.session.scalar(
            select(func.count())
            .select_from(WorkOrderAsset)
            .where(WorkOrderAsset.work_order_id == wo.id)
        ) or 0
        done = db.session.scalar(
            select(func.count())
            .select_from(WorkOrderAsset)
            .where(
                WorkOrderAsset.work_order_id == wo.id,
                WorkOrderAsset.completed_at.isnot(None),
            )
        ) or 0
        out.append({
            "wo_number": wo.wo_number,
            "title": wo.title,
            "category": wo.category,
            "priority": wo.priority,
            "status": wo.status,
            "scheduled_for": wo.scheduled_for.isoformat() if wo.scheduled_for else None,
            "due_by": wo.due_by.isoformat() if wo.due_by else None,
            "is_overdue": bool(wo.due_by and wo.due_by < now),
            "asset_total": int(total),
            "asset_done": int(done),
        })
    return out


def _recent_activity(since: datetime) -> list[dict[str, Any]]:
    """Recent comments + status transitions across the tenant — last 48h,
    capped at 12. Mixed and re-sorted by occurred_at desc."""
    comment_rows = db.session.execute(
        select(Comment).where(Comment.created_at >= since).order_by(desc(Comment.created_at)).limit(20)
    ).scalars().all()
    # AuditLog isn't TenantScopedMixin — must filter explicitly so the
    # session listener doesn't accidentally let cross-tenant rows through.
    audit_rows = db.session.execute(
        select(AuditLog)
        .where(
            AuditLog.tenant_id == current_user.tenant_id,
            AuditLog.occurred_at >= since,
            AuditLog.action.in_(("wo_transition", "sr_transition", "sr_dispatch")),
        )
        .order_by(desc(AuditLog.occurred_at))
        .limit(20)
    ).scalars().all()

    items: list[dict[str, Any]] = []
    for c in comment_rows:
        items.append({
            "kind": "comment",
            "occurred_at": c.created_at.isoformat(),
            "entity_type": c.entity_type,
            "entity_id": c.entity_id,
            "summary": c.body[:140],
        })
    for ev in audit_rows:
        before = (ev.before or {}).get("status") if isinstance(ev.before, dict) else None
        after = (ev.after or {}).get("status") if isinstance(ev.after, dict) else None
        items.append({
            "kind": "transition",
            "occurred_at": ev.occurred_at.isoformat(),
            "entity_type": ev.entity_type,
            "entity_id": ev.entity_id,
            "summary": (
                f"{before} → {after}" if before and after else ev.action
            ),
        })
    items.sort(key=lambda x: x["occurred_at"], reverse=True)
    return items[:12]


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


def _throughput_7d(week_ago: datetime, now: datetime) -> list[dict[str, Any]]:
    """7-day completion bucket for the sparkline-like trend in the KPI
    strip. One bucket per day, oldest first."""
    out: list[dict[str, Any]] = []
    for i in range(6, -1, -1):
        day_start = (now - timedelta(days=i)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        day_end = day_start + timedelta(days=1)
        n = db.session.scalar(
            select(func.count())
            .select_from(WorkOrder)
            .where(
                WorkOrder.status == "completed",
                WorkOrder.completed_at >= day_start,
                WorkOrder.completed_at < day_end,
            )
        ) or 0
        out.append({"date": day_start.date().isoformat(), "completed": int(n)})
    return out
