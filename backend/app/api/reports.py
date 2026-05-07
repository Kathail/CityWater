from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_login import current_user, login_required

from app.errors import ValidationError
from app.extensions import db
from app.models import Tenant
from app.services.permissions import require_roles
from app.services.report_renderers import render_csv_lines, render_pdf
from app.services.reports import (
    ReportResult,
    age_distribution,
    break_history,
    condition_criticality_matrix,
    inspection_summary,
    wo_summary,
)

reports_bp = Blueprint("reports", __name__, url_prefix="/api/v1/reports")

VALID_FORMATS = {"json", "csv", "pdf"}


def _format() -> str:
    fmt = (request.args.get("format") or "json").lower()
    if fmt not in VALID_FORMATS:
        raise ValidationError(
            f"format must be one of {sorted(VALID_FORMATS)}",
            code="bad_format",
        )
    return fmt


def _tenant_name() -> str:
    tenant = db.session.get(Tenant, current_user.tenant_id)
    return tenant.name if tenant else "(unknown tenant)"


def _slugify(value: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in value.lower())


def _respond(result: ReportResult, slug: str) -> Response:
    fmt = _format()
    generated_at = datetime.now(UTC)

    if fmt == "json":
        return jsonify(
            {
                "title": result.title,
                "subtitle": result.subtitle,
                "headers": result.headers,
                "rows": result.rows,
                "generated_at": generated_at.isoformat(),
                "tenant": _tenant_name(),
            }
        )

    if fmt == "csv":
        filename = f"{slug}-{generated_at.date().isoformat()}.csv"
        return Response(
            stream_with_context(render_csv_lines(result.headers, result.rows)),
            mimetype="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "private, no-store",
            },
        )

    # pdf
    pdf_bytes = render_pdf(
        title=result.title,
        subtitle=result.subtitle,
        headers=result.headers,
        rows=result.rows,
        tenant_name=_tenant_name(),
        generated_at=generated_at,
    )
    filename = f"{slug}-{generated_at.date().isoformat()}.pdf"
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


def _route(name: str, slug: str, runner: Callable[..., ReportResult], **kwarg_names: str) -> Callable[[], Response]:
    """Build a Flask view that maps query string args to the runner kwargs."""

    @login_required
    @require_roles("admin", "supervisor", "readonly")
    def view() -> Response:
        kwargs: dict[str, Any] = {}
        for kwarg, query_key in kwarg_names.items():
            val = request.args.get(query_key)
            if val:
                kwargs[kwarg] = val
        result = runner(**kwargs)
        return _respond(result, slug)

    view.__name__ = name
    return view


@reports_bp.get("")
@login_required
@require_roles("admin", "supervisor", "readonly")
def list_reports() -> Response:
    """Catalog of available reports — handy for the frontend index page."""
    return jsonify(
        [
            {
                "slug": "break-history",
                "title": "Main break history",
                "description": ("Reactive WOs categorized as main break, with the asset's class and material."),
                "filters": [
                    {"name": "from", "type": "date"},
                    {"name": "to", "type": "date"},
                    {"name": "class", "type": "asset_class_code"},
                ],
            },
            {
                "slug": "wo-summary",
                "title": "Work order summary",
                "description": "Counts of work orders by status and category over a date range.",
                "filters": [
                    {"name": "from", "type": "date"},
                    {"name": "to", "type": "date"},
                ],
            },
            {
                "slug": "inspection-summary",
                "title": "Inspection summary",
                "description": "Counts and pass/fail breakdown by inspection kind.",
                "filters": [
                    {"name": "from", "type": "date"},
                    {"name": "to", "type": "date"},
                    {"name": "kind", "type": "inspection_kind"},
                ],
            },
            {
                "slug": "age-distribution",
                "title": "Asset age distribution",
                "description": ("Asset counts bucketed by install age (0-10y, 10-25y, 25-50y, 50+y, unknown)."),
                "filters": [{"name": "domain", "type": "domain"}],
            },
            {
                "slug": "condition-criticality-matrix",
                "title": "Condition × criticality matrix",
                "description": "Asset counts by condition (1-5) × criticality (1-5).",
                "filters": [{"name": "domain", "type": "domain"}],
            },
        ]
    )


# Register each report endpoint.
reports_bp.add_url_rule(
    "/break-history",
    view_func=_route(
        "break_history",
        "break-history",
        break_history,
        date_from="from",
        date_to="to",
        class_code="class",
    ),
)
reports_bp.add_url_rule(
    "/wo-summary",
    view_func=_route(
        "wo_summary",
        "wo-summary",
        wo_summary,
        date_from="from",
        date_to="to",
    ),
)
reports_bp.add_url_rule(
    "/inspection-summary",
    view_func=_route(
        "inspection_summary",
        "inspection-summary",
        inspection_summary,
        date_from="from",
        date_to="to",
        kind="kind",
    ),
)
reports_bp.add_url_rule(
    "/age-distribution",
    view_func=_route(
        "age_distribution",
        "age-distribution",
        age_distribution,
        domain="domain",
    ),
)
reports_bp.add_url_rule(
    "/condition-criticality-matrix",
    view_func=_route(
        "condition_criticality_matrix",
        "condition-criticality-matrix",
        condition_criticality_matrix,
        domain="domain",
    ),
)
