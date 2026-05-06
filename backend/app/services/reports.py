"""Canned report queries.

Each report function returns a `ReportResult` — title + subtitle + headers +
rows. The API layer converts that to JSON, CSV, or PDF.

Tenancy is enforced upstream by the SQLAlchemy session listener
(`app/services/tenancy.py::_apply_tenant_filter`); these queries do not need
to filter by tenant_id explicitly.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import case, cast, func, select

from app.errors import ValidationError
from app.extensions import db
from app.models import Asset, AssetClass, Inspection, WorkOrder

# Allowed domain values mirror SPEC §3.4 / §3.7 enum.
DOMAINS = ("water", "sewer", "storm")


@dataclass
class ReportResult:
    """Container for a canned report's content + metadata."""

    title: str
    subtitle: str
    headers: list[str]
    rows: list[list[Any]]


def _parse_date(value: str | None, *, name: str) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        # Accept date-only ('2026-01-01') or full ISO; anchor to UTC midnight
        # for date-only so range filters are tz-stable.
        if len(value) == 10:
            dt = datetime.fromisoformat(value).replace(tzinfo=UTC)
        else:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
        return dt
    except ValueError as e:
        raise ValidationError(f"`{name}` must be ISO-8601 date or datetime", code="bad_date") from e


def _range_subtitle(date_from: datetime | None, date_to: datetime | None) -> str:
    if date_from and date_to:
        return f"From {date_from.date()} to {date_to.date()} (inclusive)"
    if date_from:
        return f"From {date_from.date()}"
    if date_to:
        return f"Through {date_to.date()}"
    return "All time"


def break_history(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    class_code: str | None = None,
) -> ReportResult:
    """Main breaks: WOs categorized as `main_break`, optionally narrowed
    by asset class. Includes the linked asset's class + UID + material."""
    df = _parse_date(date_from, name="from")
    dt = _parse_date(date_to, name="to")

    stmt = (
        select(WorkOrder, Asset, AssetClass)
        .outerjoin(Asset, WorkOrder.asset_id == Asset.id)
        .outerjoin(AssetClass, Asset.class_code == AssetClass.code)
        .where(WorkOrder.category == "main_break")
        .order_by(WorkOrder.created_at.asc())
    )
    if df:
        stmt = stmt.where(WorkOrder.created_at >= df)
    if dt:
        stmt = stmt.where(WorkOrder.created_at <= dt)
    if class_code:
        stmt = stmt.where(Asset.class_code == class_code)

    rows: list[list[Any]] = []
    for wo, asset, klass in db.session.execute(stmt).all():
        rows.append(
            [
                wo.wo_number,
                wo.created_at.date().isoformat(),
                wo.status,
                wo.priority,
                asset.asset_uid if asset else "",
                klass.name if klass else "",
                asset.material if asset and asset.material else "",
                asset.diameter_mm if asset and asset.diameter_mm else "",
                wo.title,
                wo.resolution or "",
            ]
        )

    subtitle_parts = [_range_subtitle(df, dt)]
    if class_code:
        subtitle_parts.append(f"class={class_code}")
    return ReportResult(
        title="Main break history",
        subtitle=" · ".join(subtitle_parts),
        headers=[
            "WO number",
            "Reported",
            "Status",
            "Priority",
            "Asset UID",
            "Class",
            "Material",
            "Diameter (mm)",
            "Title",
            "Resolution",
        ],
        rows=rows,
    )


def wo_summary(*, date_from: str | None = None, date_to: str | None = None) -> ReportResult:
    """Counts of work orders by status × category in the window."""
    df = _parse_date(date_from, name="from")
    dt = _parse_date(date_to, name="to")

    stmt = (
        select(WorkOrder.status, WorkOrder.category, func.count(WorkOrder.id))
        .group_by(WorkOrder.status, WorkOrder.category)
        .order_by(WorkOrder.status, WorkOrder.category)
    )
    if df:
        stmt = stmt.where(WorkOrder.created_at >= df)
    if dt:
        stmt = stmt.where(WorkOrder.created_at <= dt)

    rows: list[list[Any]] = []
    for status, category, count in db.session.execute(stmt).all():
        rows.append([status, category, int(count)])

    return ReportResult(
        title="Work order summary",
        subtitle=_range_subtitle(df, dt),
        headers=["Status", "Category", "Count"],
        rows=rows,
    )


def inspection_summary(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    kind: str | None = None,
) -> ReportResult:
    """Per-kind counts with pass/fail breakdown and mean overall condition."""
    df = _parse_date(date_from, name="from")
    dt = _parse_date(date_to, name="to")

    pass_count = func.sum(case((Inspection.pass_.is_(True), 1), else_=0))
    fail_count = func.sum(case((Inspection.pass_.is_(False), 1), else_=0))
    null_count = func.sum(case((Inspection.pass_.is_(None), 1), else_=0))

    stmt = (
        select(
            Inspection.kind,
            func.count(Inspection.id),
            pass_count,
            fail_count,
            null_count,
            func.avg(Inspection.overall_condition),
        )
        .group_by(Inspection.kind)
        .order_by(Inspection.kind)
    )
    if df:
        stmt = stmt.where(Inspection.performed_at >= df)
    if dt:
        stmt = stmt.where(Inspection.performed_at <= dt)
    if kind:
        stmt = stmt.where(Inspection.kind == kind)

    rows: list[list[Any]] = []
    for k, total, passed, failed, untracked, mean_cond in db.session.execute(stmt).all():
        rows.append(
            [
                k,
                int(total),
                int(passed or 0),
                int(failed or 0),
                int(untracked or 0),
                round(float(mean_cond), 2) if mean_cond is not None else "",
            ]
        )

    subtitle_parts = [_range_subtitle(df, dt)]
    if kind:
        subtitle_parts.append(f"kind={kind}")
    return ReportResult(
        title="Inspection summary",
        subtitle=" · ".join(subtitle_parts),
        headers=[
            "Kind",
            "Total",
            "Passed",
            "Failed",
            "Untracked",
            "Mean condition",
        ],
        rows=rows,
    )


def age_distribution(*, domain: str | None = None) -> ReportResult:
    """Asset age buckets per class, by install_date.

    Buckets reflect typical utility-asset lifecycle thresholds:
      0-10y, 10-25y, 25-50y, 50+y, unknown
    """
    if domain is not None and domain not in DOMAINS:
        raise ValidationError(f"`domain` must be one of {DOMAINS}", code="bad_domain")

    today = datetime.now(UTC).date()
    age_years = func.extract(
        "year",
        func.age(cast(today, db.Date), Asset.install_date),
    )
    bucket = case(
        (Asset.install_date.is_(None), "unknown"),
        (age_years < 10, "0-10y"),
        (age_years < 25, "10-25y"),
        (age_years < 50, "25-50y"),
        else_="50+y",
    ).label("bucket")

    stmt = (
        select(AssetClass.code, AssetClass.name, bucket, func.count(Asset.id))
        .join(AssetClass, Asset.class_code == AssetClass.code)
        .group_by(AssetClass.code, AssetClass.name, bucket)
        .order_by(AssetClass.code, bucket)
    )
    if domain:
        stmt = stmt.where(AssetClass.domain == domain)

    rows: list[list[Any]] = []
    for class_code, class_name, b, count in db.session.execute(stmt).all():
        rows.append([class_code, class_name, b, int(count)])

    return ReportResult(
        title="Asset age distribution",
        subtitle=f"Domain: {domain}" if domain else "All domains",
        headers=["Class code", "Class", "Age bucket", "Count"],
        rows=rows,
    )


def condition_criticality_matrix(*, domain: str | None = None) -> ReportResult:
    """5×5 matrix of condition (1-5) × criticality (1-5) asset counts.

    The output is one row per (condition, criticality) combination — easier
    for CSV/PDF rendering than a true 2-D table. Combinations with zero
    assets are omitted; consumers can fill the matrix client-side.
    """
    if domain is not None and domain not in DOMAINS:
        raise ValidationError(f"`domain` must be one of {DOMAINS}", code="bad_domain")

    stmt = (
        select(
            Asset.condition,
            Asset.criticality,
            func.count(Asset.id),
        )
        .join(AssetClass, Asset.class_code == AssetClass.code)
        .group_by(Asset.condition, Asset.criticality)
        .order_by(Asset.condition, Asset.criticality)
    )
    if domain:
        stmt = stmt.where(AssetClass.domain == domain)

    rows: list[list[Any]] = []
    for cond, crit, count in db.session.execute(stmt).all():
        rows.append(
            [
                cond if cond is not None else "n/a",
                crit if crit is not None else "n/a",
                int(count),
            ]
        )

    return ReportResult(
        title="Condition × criticality matrix",
        subtitle=f"Domain: {domain}" if domain else "All domains",
        headers=["Condition (1-5)", "Criticality (1-5)", "Asset count"],
        rows=rows,
    )
