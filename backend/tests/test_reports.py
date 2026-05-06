from __future__ import annotations

import csv
from datetime import UTC, datetime
from io import StringIO

import pytest
from flask import g

from app.extensions import db
from app.models import Inspection, WorkOrder
from app.services.inspection_number import next_inspection_number
from app.services.wo_number import next_wo_number
from tests.conftest import login_client, make_user


@pytest.fixture
def readonly_client(app, tenant):
    g.skip_tenant_filter = True
    make_user(tenant, email="ro@acme.io", role_codes=["readonly"])
    db.session.commit()
    c = app.test_client()
    login_client(c, "acme", "ro@acme.io")
    return c


def _make_wo(tenant, *, category: str = "main_break", status: str = "open", **fields):
    g.skip_tenant_filter = True
    n = next_wo_number(tenant_id=tenant.id)
    wo = WorkOrder(
        tenant_id=tenant.id,
        wo_number=n,
        type="reactive",
        category=category,
        priority="normal",
        status=status,
        title=fields.pop("title", "Test"),
        **fields,
    )
    db.session.add(wo)
    db.session.commit()
    return wo


def _make_ins(tenant, *, kind: str = "hydrant_flow", **fields):
    g.skip_tenant_filter = True
    n = next_inspection_number(tenant_id=tenant.id)
    fields.setdefault("performed_at", datetime.now(UTC))
    fields.setdefault("data", {})
    ins = Inspection(
        tenant_id=tenant.id,
        inspection_number=n,
        kind=kind,
        **fields,
    )
    db.session.add(ins)
    db.session.commit()
    return ins


# ---------- catalog ----------


def test_list_reports_catalog(admin_client):
    resp = admin_client.get("/api/v1/reports")
    assert resp.status_code == 200
    body = resp.get_json()
    slugs = {r["slug"] for r in body}
    assert slugs == {
        "break-history",
        "wo-summary",
        "inspection-summary",
        "age-distribution",
        "condition-criticality-matrix",
    }


# ---------- break history ----------


def test_break_history_includes_main_break_only(admin_client, tenant):
    _make_wo(tenant, category="main_break", title="Burst on Maple")
    _make_wo(tenant, category="repair", title="Pothole patch")
    resp = admin_client.get("/api/v1/reports/break-history")
    body = resp.get_json()
    assert resp.status_code == 200
    assert len(body["rows"]) == 1
    assert body["rows"][0][8] == "Burst on Maple"


def test_break_history_date_range_inclusive(admin_client, tenant):
    g.skip_tenant_filter = True
    old = _make_wo(tenant, category="main_break", title="Old break")
    old.created_at = datetime(2020, 1, 1, tzinfo=UTC)
    db.session.commit()
    _make_wo(tenant, category="main_break", title="Recent break")

    resp = admin_client.get("/api/v1/reports/break-history?from=2024-01-01")
    rows = resp.get_json()["rows"]
    titles = {r[8] for r in rows}
    assert "Recent break" in titles
    assert "Old break" not in titles


def test_break_history_csv_matches_json(admin_client, tenant):
    _make_wo(tenant, category="main_break", title="A")
    _make_wo(tenant, category="main_break", title="B")
    json_resp = admin_client.get("/api/v1/reports/break-history")
    csv_resp = admin_client.get("/api/v1/reports/break-history?format=csv")
    assert csv_resp.status_code == 200
    assert csv_resp.mimetype == "text/csv"
    reader = csv.reader(StringIO(csv_resp.get_data(as_text=True)))
    csv_rows = list(reader)
    # header + N rows
    assert len(csv_rows) == 1 + len(json_resp.get_json()["rows"])
    assert csv_rows[0][0] == "WO number"


def test_break_history_pdf_renders(admin_client, tenant):
    _make_wo(tenant, category="main_break", title="PDF test")
    resp = admin_client.get("/api/v1/reports/break-history?format=pdf")
    assert resp.status_code == 200
    assert resp.mimetype == "application/pdf"
    body = resp.get_data()
    assert body[:4] == b"%PDF"
    assert len(body) > 1000  # sanity: bigger than just headers


# ---------- wo summary ----------


def test_wo_summary_groups_correctly(admin_client, tenant):
    _make_wo(tenant, category="repair", status="open")
    _make_wo(tenant, category="repair", status="open")
    _make_wo(tenant, category="flushing", status="completed")
    resp = admin_client.get("/api/v1/reports/wo-summary")
    rows = resp.get_json()["rows"]
    counts = {(r[0], r[1]): r[2] for r in rows}
    assert counts[("open", "repair")] == 2
    assert counts[("completed", "flushing")] == 1


# ---------- inspection summary ----------


def test_inspection_summary_pass_fail_breakdown(admin_client, tenant):
    _make_ins(tenant, kind="hydrant_flow", overall_condition=2, **{"pass_": True})
    _make_ins(tenant, kind="hydrant_flow", overall_condition=4, **{"pass_": False})
    _make_ins(tenant, kind="manhole", **{"pass_": True})
    resp = admin_client.get("/api/v1/reports/inspection-summary")
    rows = {r[0]: r for r in resp.get_json()["rows"]}
    assert rows["hydrant_flow"][1] == 2  # total
    assert rows["hydrant_flow"][2] == 1  # passed
    assert rows["hydrant_flow"][3] == 1  # failed
    assert rows["hydrant_flow"][5] == 3.0  # mean (2+4)/2


def test_inspection_summary_kind_filter(admin_client, tenant):
    _make_ins(tenant, kind="hydrant_flow", **{"pass_": True})
    _make_ins(tenant, kind="manhole", **{"pass_": True})
    resp = admin_client.get("/api/v1/reports/inspection-summary?kind=manhole")
    rows = resp.get_json()["rows"]
    assert len(rows) == 1
    assert rows[0][0] == "manhole"


# ---------- age distribution ----------


def test_age_distribution_buckets_by_class(admin_client, tenant):
    from datetime import date

    from tests.conftest import make_asset

    make_asset(
        tenant,
        class_code="WAT_HYD",
        asset_uid="HYD-1",
        install_date=date(2020, 1, 1),
    )
    make_asset(
        tenant,
        class_code="WAT_HYD",
        asset_uid="HYD-2",
        install_date=date(1990, 1, 1),
    )
    make_asset(
        tenant,
        class_code="WAT_HYD",
        asset_uid="HYD-3",
    )  # no install_date → unknown
    db.session.commit()

    resp = admin_client.get("/api/v1/reports/age-distribution?domain=water")
    rows = resp.get_json()["rows"]
    by_bucket = {r[2]: r[3] for r in rows if r[0] == "WAT_HYD"}
    assert by_bucket.get("0-10y", 0) >= 1
    assert by_bucket.get("25-50y", 0) >= 1
    assert by_bucket.get("unknown", 0) == 1


def test_age_distribution_bad_domain_422(admin_client):
    resp = admin_client.get("/api/v1/reports/age-distribution?domain=not_real")
    assert resp.status_code == 422


# ---------- condition × criticality matrix ----------


def test_condition_criticality_matrix(admin_client, tenant):
    from tests.conftest import make_asset

    make_asset(tenant, class_code="WAT_HYD", asset_uid="C1", condition=2, criticality=4)
    make_asset(tenant, class_code="WAT_HYD", asset_uid="C2", condition=2, criticality=4)
    make_asset(tenant, class_code="WAT_HYD", asset_uid="C3", condition=5, criticality=3)
    db.session.commit()

    resp = admin_client.get("/api/v1/reports/condition-criticality-matrix")
    rows = resp.get_json()["rows"]
    cells = {(r[0], r[1]): r[2] for r in rows}
    assert cells.get((2, 4)) == 2
    assert cells.get((5, 3)) == 1


# ---------- format + auth ----------


def test_bad_format_422(admin_client):
    resp = admin_client.get("/api/v1/reports/wo-summary?format=xml")
    assert resp.status_code == 422


def test_readonly_can_run_reports(readonly_client, tenant):
    _make_wo(tenant, category="main_break", title="Audit")
    resp = readonly_client.get("/api/v1/reports/break-history")
    assert resp.status_code == 200


def test_tech_forbidden(tech_client):
    resp = tech_client.get("/api/v1/reports/wo-summary")
    assert resp.status_code == 403


def test_unauth_returns_401(client):
    resp = client.get("/api/v1/reports")
    assert resp.status_code == 401


def test_pdf_includes_tenant_header(admin_client, tenant):
    _make_wo(tenant, category="main_break", title="Tenant header check")
    resp = admin_client.get("/api/v1/reports/wo-summary?format=pdf")
    assert resp.status_code == 200
    body = resp.get_data()
    assert body[:4] == b"%PDF"
    # Tenant name "Acme Water" is in the document author metadata; confirm
    # by searching the byte stream (sufficient for a smoke check — PDFs are
    # not human-readable but our title + author are written verbatim).
    assert b"Acme Water" in body
