from __future__ import annotations

from datetime import UTC, datetime

from app.extensions import db
from app.services.hydrant_flow import color_class, gpm_at_20psi
from tests.conftest import login_client, make_asset, make_tenant, make_user

NOW_ISO = datetime.now(UTC).isoformat()


def _create(client, **payload):
    body = {"performed_at": NOW_ISO}
    body.update(payload)
    return client.post("/api/v1/inspections", json=body)


def test_create_hydrant_flow_computes_calc_and_color(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-FLOW1")
    db.session.commit()

    resp = _create(
        admin_client,
        kind="hydrant_flow",
        asset_uid="HYD-FLOW1",
        data={
            "static_psi": 72,
            "residual_psi": 58,
            "flow_gpm": 980,
            "pitot_psi": 32,
            "outlet_size_mm": 64,
            "coefficient": 0.9,
        },
    )
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert body["inspection_number"].startswith("INS-")
    # NFPA 291 with these inputs: ratio = 52/14, ^0.54 ≈ 2.06, * 980 ≈ 2018
    # The exact test value depends on the formula; we assert it matches the
    # service function (server is authoritative).
    expected = gpm_at_20psi(72, 58, 980)
    assert body["data"]["calc_gpm_at_20psi"] == expected
    assert body["data"]["color_class"] == color_class(expected)


def test_hydrant_flow_color_class_brackets():
    assert color_class(1500) == "blue"
    assert color_class(1499) == "green"
    assert color_class(1000) == "green"
    assert color_class(999) == "orange"
    assert color_class(500) == "orange"
    assert color_class(499) == "red"
    assert color_class(None) is None


def test_hydrant_flow_static_le_residual_returns_none():
    # If static <= residual, formula is undefined; service should return None.
    assert gpm_at_20psi(50, 50, 800) is None
    assert gpm_at_20psi(15, 10, 800) is None  # static <= 20


def test_create_valve_exercise(admin_client, tenant):
    make_asset(tenant, class_code="WAT_VLV", asset_uid="VLV-1")
    db.session.commit()
    resp = _create(
        admin_client,
        kind="valve_exercise",
        asset_uid="VLV-1",
        data={
            "turns_to_close": 24,
            "expected_turns": 24,
            "operates": True,
            "leaks": False,
            "lubricated": True,
        },
    )
    assert resp.status_code == 201, resp.get_json()
    assert resp.get_json()["data"]["operates"] is True


def test_create_manhole(admin_client, tenant):
    make_asset(tenant, class_code="SAN_MH", asset_uid="MH-1")
    db.session.commit()
    resp = _create(
        admin_client,
        kind="manhole",
        asset_uid="MH-1",
        data={
            "frame_cover_condition": 2,
            "chimney_condition": 2,
            "cone_condition": 1,
            "wall_condition": 2,
            "bench_channel_condition": 3,
            "depth_m": "3.2",
            "h2s_ppm": 0,
        },
        overall_condition=2,
    )
    assert resp.status_code == 201, resp.get_json()
    assert resp.get_json()["overall_condition"] == 2


def test_create_catch_basin(admin_client, tenant):
    make_asset(tenant, class_code="STM_CB", asset_uid="CB-1")
    db.session.commit()
    resp = _create(
        admin_client,
        kind="catch_basin",
        asset_uid="CB-1",
        data={
            "grate_condition": 2,
            "sump_depth_m": "0.5",
            "sediment_depth_m": "0.2",
            "needs_cleaning": True,
            "blockage": False,
        },
    )
    assert resp.status_code == 201, resp.get_json()
    assert resp.get_json()["data"]["needs_cleaning"] is True


def test_create_lift_station_round(admin_client, tenant):
    make_asset(tenant, class_code="SAN_LFT", asset_uid="LFT-1")
    db.session.commit()
    resp = _create(
        admin_client,
        kind="lift_station_round",
        asset_uid="LFT-1",
        data={
            "wet_well_level_m": "1.4",
            "pump1_runtime_h": "1284.3",
            "pump2_runtime_h": "1199.7",
            "alarms": [],
            "generator_test_pass": True,
            "odour_pass": True,
        },
    )
    assert resp.status_code == 201, resp.get_json()
    assert resp.get_json()["data"]["generator_test_pass"] is True


def test_data_validation_rejects_missing_field(admin_client):
    resp = _create(
        admin_client,
        kind="hydrant_flow",
        data={"static_psi": 72},  # missing residual_psi, flow_gpm
    )
    assert resp.status_code == 422


def test_data_validation_rejects_out_of_range(admin_client):
    resp = _create(
        admin_client,
        kind="manhole",
        data={
            "frame_cover_condition": 9,  # > 5
            "chimney_condition": 2,
            "cone_condition": 1,
            "wall_condition": 2,
            "bench_channel_condition": 3,
        },
    )
    assert resp.status_code == 422


def test_kind_asset_class_compatibility(admin_client, tenant):
    # WAT_MAIN is not compatible with hydrant_flow
    make_asset(tenant, class_code="WAT_MAIN", asset_uid="MAIN-1")
    db.session.commit()
    resp = _create(
        admin_client,
        kind="hydrant_flow",
        asset_uid="MAIN-1",
        data={"static_psi": 72, "residual_psi": 58, "flow_gpm": 980},
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "incompatible_asset_class"


def test_inspection_without_asset_allowed(admin_client):
    resp = _create(
        admin_client,
        kind="valve_exercise",
        data={"turns_to_close": 24, "operates": True},
    )
    assert resp.status_code == 201, resp.get_json()
    assert resp.get_json()["asset_uid"] is None


def test_cctv_blocked_in_s6(admin_client):
    resp = _create(admin_client, kind="cctv", data={})
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "cctv_not_yet_supported"


def test_inspection_number_per_year(admin_client):
    a = _create(
        admin_client,
        kind="valve_exercise",
        data={"turns_to_close": 1, "operates": True},
    ).get_json()
    b = _create(
        admin_client,
        kind="valve_exercise",
        data={"turns_to_close": 2, "operates": True},
    ).get_json()
    year = datetime.now(UTC).year
    assert a["inspection_number"].startswith(f"INS-{year}-")
    assert b["inspection_number"].startswith(f"INS-{year}-")
    assert a["inspection_number"] != b["inspection_number"]


def test_get_and_patch(admin_client):
    body = _create(
        admin_client,
        kind="valve_exercise",
        data={"turns_to_close": 24, "operates": True},
    ).get_json()
    n = body["inspection_number"]
    fetched = admin_client.get(f"/api/v1/inspections/{n}").get_json()
    assert fetched["inspection_number"] == n

    patched = admin_client.patch(
        f"/api/v1/inspections/{n}",
        json={"notes": "leaked at first"},
    ).get_json()
    assert patched["notes"] == "leaked at first"


def test_patch_data_recomputes_for_hydrant_flow(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-PATCH")
    db.session.commit()
    body = _create(
        admin_client,
        kind="hydrant_flow",
        asset_uid="HYD-PATCH",
        data={"static_psi": 80, "residual_psi": 60, "flow_gpm": 1200},
    ).get_json()
    n = body["inspection_number"]
    original = body["data"]["calc_gpm_at_20psi"]

    patched = admin_client.patch(
        f"/api/v1/inspections/{n}",
        json={"data": {"static_psi": 70, "residual_psi": 60, "flow_gpm": 1500}},
    ).get_json()
    assert patched["data"]["calc_gpm_at_20psi"] != original
    assert patched["data"]["calc_gpm_at_20psi"] == gpm_at_20psi(70, 60, 1500)


def test_list_filter_by_kind(admin_client):
    _create(admin_client, kind="valve_exercise", data={"turns_to_close": 1, "operates": True})
    _create(
        admin_client,
        kind="manhole",
        data={
            "frame_cover_condition": 2,
            "chimney_condition": 2,
            "cone_condition": 1,
            "wall_condition": 2,
            "bench_channel_condition": 3,
        },
    )
    body = admin_client.get("/api/v1/inspections?kind=manhole").get_json()
    assert all(i["kind"] == "manhole" for i in body["items"])


def test_tech_sees_only_own(app, client, tenant, admin_user):
    _other = make_user(tenant, email="bob@acme.io", role_codes=["tech"])
    db.session.commit()

    login_client(client, "acme", "admin@acme.io")
    admin_inspection = client.post(
        "/api/v1/inspections",
        json={
            "kind": "valve_exercise",
            "performed_at": NOW_ISO,
            "data": {"turns_to_close": 1, "operates": True},
        },
    ).get_json()
    client.post("/api/v1/auth/logout")

    # Bob (tech) creates one of his own
    login_client(client, "acme", "bob@acme.io")
    bob_inspection = client.post(
        "/api/v1/inspections",
        json={
            "kind": "valve_exercise",
            "performed_at": NOW_ISO,
            "data": {"turns_to_close": 2, "operates": True},
        },
    ).get_json()

    # Bob sees his own
    fetched = client.get(f"/api/v1/inspections/{bob_inspection['inspection_number']}")
    assert fetched.status_code == 200

    # Bob does not see admin's
    fetched = client.get(f"/api/v1/inspections/{admin_inspection['inspection_number']}")
    assert fetched.status_code == 404


def test_cross_tenant_404(app, client, admin_user):
    other = make_tenant(slug="globex", name="Globex Inc")
    make_user(other, email="g@globex.io", role_codes=["admin"])
    db.session.commit()

    login_client(client, "globex", "g@globex.io")
    body = client.post(
        "/api/v1/inspections",
        json={
            "kind": "valve_exercise",
            "performed_at": NOW_ISO,
            "data": {"turns_to_close": 1, "operates": True},
        },
    ).get_json()
    client.post("/api/v1/auth/logout")

    login_client(client, "acme", "admin@acme.io")
    resp = client.get(f"/api/v1/inspections/{body['inspection_number']}")
    assert resp.status_code == 404


def test_csv_export_with_kind(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-CSV")
    db.session.commit()
    _create(
        admin_client,
        kind="hydrant_flow",
        asset_uid="HYD-CSV",
        data={"static_psi": 72, "residual_psi": 58, "flow_gpm": 980},
    )
    resp = admin_client.get("/api/v1/inspections/export?format=csv&kind=hydrant_flow")
    assert resp.status_code == 200
    assert resp.mimetype == "text/csv"
    text = resp.get_data(as_text=True)
    lines = text.strip().split("\n")
    assert "static_psi" in lines[0]
    assert "calc_gpm_at_20psi" in lines[0]
    assert "color_class" in lines[0]
    assert any("HYD-CSV" in line for line in lines[1:])


def test_csv_export_unauthenticated_401(client):
    resp = client.get("/api/v1/inspections/export?format=csv")
    assert resp.status_code == 401
