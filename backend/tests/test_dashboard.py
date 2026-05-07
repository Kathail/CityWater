"""Smoke coverage for /api/v1/dashboard.

Validates the response shape and that the eight sub-builders all return
without exceptions on a tenant with mixed data. Detailed per-builder
assertions are deliberately light — the dashboard is a presentation
layer over data covered by other tests.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from flask import g

from app.extensions import db
from app.models import ServiceRequest, WorkOrder
from tests.conftest import make_tenant, make_user


@pytest.fixture
def seeded(app, tenant):
    """Insert a small mix: open + completed WO, new + closed SR."""
    g.skip_tenant_filter = True
    wo_open = WorkOrder(
        tenant_id=tenant.id,
        wo_number="WO-2026-00001",
        type="reactive",
        category="repair",
        priority="high",
        status="open",
        title="Open WO",
        due_by=datetime.now(UTC) + timedelta(days=2),
    )
    wo_done = WorkOrder(
        tenant_id=tenant.id,
        wo_number="WO-2026-00002",
        type="reactive",
        category="repair",
        priority="normal",
        status="completed",
        title="Completed WO",
        completed_at=datetime.now(UTC) - timedelta(hours=2),
    )
    sr_new = ServiceRequest(
        tenant_id=tenant.id,
        sr_number="SR-2026-00001",
        category="no_water",
        domain="water",
        priority="normal",
        status="new",
        reported_at=datetime.now(UTC),
    )
    sr_closed = ServiceRequest(
        tenant_id=tenant.id,
        sr_number="SR-2026-00002",
        category="no_water",
        domain="water",
        priority="normal",
        status="closed",
        reported_at=datetime.now(UTC) - timedelta(days=2),
        closed_at=datetime.now(UTC) - timedelta(days=1),
    )
    db.session.add_all([wo_open, wo_done, sr_new, sr_closed])
    db.session.commit()
    return {"wo_open": wo_open, "wo_done": wo_done, "sr_new": sr_new}


def test_dashboard_returns_full_envelope(admin_client, seeded):
    resp = admin_client.get("/api/v1/dashboard")
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    # Every top-level key the frontend reads.
    for key in (
        "wo_kpis",
        "sr_kpis",
        "today_queue",
        "wo_by_category_30d",
        "sr_by_priority_30d",
        "throughput_7d",
        "by_area",
        "recent_activity",
    ):
        assert key in body, f"missing dashboard key: {key}"


def test_dashboard_kpis_reflect_seed(admin_client, seeded):
    body = admin_client.get("/api/v1/dashboard").get_json()
    wo = body["wo_kpis"]
    sr = body["sr_kpis"]
    assert wo["open"] >= 1
    assert wo["completed_this_week"] >= 1
    assert sr["new"] >= 1


def test_dashboard_is_tenant_scoped(app, admin_client, tenant):
    """A WO in another tenant must not appear in this tenant's dashboard.

    DASH-P1-10: tightened from a simple today_queue membership check
    (which would pass even without the listener — the queue filters by
    assigned_to and other-tenant WOs have no assigned_to in our seed)
    to a strong assertion that wo_kpis.open does NOT increment when
    another tenant adds an open WO. This actually exercises the
    session-level tenant-filter listener.
    """
    baseline = admin_client.get("/api/v1/dashboard").get_json()
    baseline_open = baseline["wo_kpis"]["open"]

    g.skip_tenant_filter = True
    other = make_tenant(slug="other-d", name="Other-D")
    db.session.add(
        WorkOrder(
            tenant_id=other.id,
            wo_number="WO-2026-OTHER",
            type="reactive",
            category="repair",
            priority="emergency",
            status="open",
            title="Should not appear",
        )
    )
    db.session.commit()

    after = admin_client.get("/api/v1/dashboard").get_json()
    queue_wos = {q["wo_number"] for q in after["today_queue"]}
    assert "WO-2026-OTHER" not in queue_wos
    # The cross-tenant open WO must NOT inflate this tenant's counter.
    assert after["wo_kpis"]["open"] == baseline_open


def test_dashboard_time_logs_are_tenant_scoped(app, admin_client, tenant, seeded):
    """Regression for WO-P0-7 (and WO-P0-2 by extension): the dashboard's
    `hours_this_week` and `stops_completed_this_week` summed across every
    tenant's `work_order_time_log` and `work_order_asset` rows because
    neither table was on TenantScopedMixin and the queries didn't join
    through `work_order`. Adding the mixins (and tenant_id columns where
    needed) brings them under the session-level filter listener."""
    from datetime import UTC, datetime, timedelta
    from decimal import Decimal

    from app.models import WorkOrderTimeLog

    g.skip_tenant_filter = True
    other = make_tenant(slug="other-tl", name="Other-TL")
    other_user = make_user(other, email="ops@other-tl.io", role_codes=["tech"])
    other_wo = WorkOrder(
        tenant_id=other.id,
        wo_number="WO-2026-OTHER-TL",
        type="reactive",
        category="repair",
        priority="normal",
        status="completed",
        title="Other-tenant WO",
        completed_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.session.add(other_wo)
    db.session.flush()
    db.session.add(
        WorkOrderTimeLog(
            tenant_id=other.id,
            work_order_id=other_wo.id,
            user_id=other_user.id,
            started_at=datetime.now(UTC) - timedelta(hours=4),
            ended_at=datetime.now(UTC) - timedelta(hours=1),
            hours_decimal=Decimal("3.00"),
        )
    )
    db.session.commit()

    body = admin_client.get("/api/v1/dashboard").get_json()
    # The other tenant's 3-hour log must NOT contribute to the acme
    # tenant's hours_this_week. The seeded fixture has zero time logs.
    assert body["wo_kpis"]["hours_this_week"] == 0
