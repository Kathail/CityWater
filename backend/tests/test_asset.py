from __future__ import annotations

from sqlalchemy import select

from app.extensions import db
from app.models import Asset, AssetClass
from tests.conftest import login_client, make_asset, make_tenant, make_user

POINT = {"type": "Point", "coordinates": [-76.5, 39.3]}
LINE = {
    "type": "LineString",
    "coordinates": [[-76.5, 39.3], [-76.4, 39.35]],
}
POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [-76.5, 39.3],
            [-76.4, 39.3],
            [-76.4, 39.4],
            [-76.5, 39.4],
            [-76.5, 39.3],
        ]
    ],
}


def test_create_point_asset(admin_client):
    resp = admin_client.post(
        "/api/v1/assets",
        json={
            "class_code": "WAT_HYD",
            "geometry": POINT,
            "material": "ductile iron",
            "diameter_mm": 150,
        },
    )
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert body["class_code"] == "WAT_HYD"
    assert body["domain"] == "water"
    assert body["material"] == "ductile iron"
    assert body["asset_uid"].startswith("HYD-")
    assert body["geometry"]["type"] == "Point"


def test_create_linestring_asset(admin_client):
    resp = admin_client.post(
        "/api/v1/assets",
        json={"class_code": "WAT_MAIN", "geometry": LINE, "material": "PVC"},
    )
    assert resp.status_code == 201
    assert resp.get_json()["asset_uid"].startswith("MAIN-")


def test_create_polygon_asset(admin_client):
    resp = admin_client.post(
        "/api/v1/assets",
        json={"class_code": "WAT_RES", "geometry": POLYGON},
    )
    assert resp.status_code == 201
    assert resp.get_json()["geometry"]["type"] == "Polygon"


def test_create_with_explicit_asset_uid(admin_client):
    resp = admin_client.post(
        "/api/v1/assets",
        json={
            "class_code": "WAT_HYD",
            "asset_uid": "HYD-CUSTOM-01",
            "geometry": POINT,
        },
    )
    assert resp.status_code == 201
    assert resp.get_json()["asset_uid"] == "HYD-CUSTOM-01"


def test_create_explicit_uid_collision_409(admin_client):
    admin_client.post(
        "/api/v1/assets",
        json={
            "class_code": "WAT_HYD",
            "asset_uid": "HYD-DUP",
            "geometry": POINT,
        },
    )
    resp = admin_client.post(
        "/api/v1/assets",
        json={
            "class_code": "WAT_HYD",
            "asset_uid": "HYD-DUP",
            "geometry": POINT,
        },
    )
    assert resp.status_code == 409
    assert resp.get_json()["error"]["code"] == "asset_uid_taken"


def test_geometry_type_mismatch_422(admin_client):
    resp = admin_client.post(
        "/api/v1/assets",
        json={"class_code": "WAT_HYD", "geometry": LINE},
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "geometry_type_mismatch"


def test_unknown_class_code_422(admin_client):
    resp = admin_client.post(
        "/api/v1/assets",
        json={"class_code": "NOPE", "geometry": POINT},
    )
    assert resp.status_code == 422


def test_uid_auto_increments_within_class(admin_client):
    a = admin_client.post(
        "/api/v1/assets", json={"class_code": "WAT_HYD", "geometry": POINT}
    ).get_json()
    b = admin_client.post(
        "/api/v1/assets", json={"class_code": "WAT_HYD", "geometry": POINT}
    ).get_json()
    assert a["asset_uid"] == "HYD-00001"
    assert b["asset_uid"] == "HYD-00002"


def test_get_asset_by_uid(admin_client, tenant):
    asset = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-LOOKUP")
    db.session.commit()
    resp = admin_client.get(f"/api/v1/assets/{asset.asset_uid}")
    assert resp.status_code == 200
    assert resp.get_json()["asset_uid"] == "HYD-LOOKUP"


def test_get_unknown_uid_404(admin_client):
    resp = admin_client.get("/api/v1/assets/NOPE-99999")
    assert resp.status_code == 404


def test_patch_asset(admin_client, tenant):
    asset = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-EDIT")
    db.session.commit()
    resp = admin_client.patch(
        f"/api/v1/assets/{asset.asset_uid}",
        json={"material": "steel", "condition": 3},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["material"] == "steel"
    assert body["condition"] == 3


def test_patch_geometry(admin_client, tenant):
    asset = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-MOVE")
    db.session.commit()
    new_point = {"type": "Point", "coordinates": [-77.0, 40.0]}
    resp = admin_client.patch(f"/api/v1/assets/{asset.asset_uid}", json={"geometry": new_point})
    assert resp.status_code == 200
    assert resp.get_json()["geometry"]["coordinates"] == [-77.0, 40.0]


def test_patch_geometry_type_mismatch_422(admin_client, tenant):
    asset = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-WRONG")
    db.session.commit()
    resp = admin_client.patch(f"/api/v1/assets/{asset.asset_uid}", json={"geometry": LINE})
    assert resp.status_code == 422


def test_soft_delete(admin_client, tenant):
    asset = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-RM")
    db.session.commit()
    resp = admin_client.delete(f"/api/v1/assets/{asset.asset_uid}")
    assert resp.status_code == 204

    follow = admin_client.get(f"/api/v1/assets/{asset.asset_uid}")
    assert follow.status_code == 404

    listed = admin_client.get("/api/v1/assets").get_json()
    assert all(a["asset_uid"] != "HYD-RM" for a in listed["items"])


def test_list_filter_by_class(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD")
    make_asset(tenant, class_code="SAN_MH")
    db.session.commit()
    body = admin_client.get("/api/v1/assets?class=WAT_HYD").get_json()
    assert all(a["class_code"] == "WAT_HYD" for a in body["items"])


def test_list_filter_by_domain(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD")
    make_asset(tenant, class_code="SAN_MH")
    db.session.commit()
    body = admin_client.get("/api/v1/assets?domain=sewer").get_json()
    assert all(a["domain"] == "sewer" for a in body["items"])


def test_list_filter_by_status(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="A1", status="active")
    make_asset(tenant, class_code="WAT_HYD", asset_uid="A2", status="abandoned")
    db.session.commit()
    body = admin_client.get("/api/v1/assets?status=abandoned").get_json()
    uids = {a["asset_uid"] for a in body["items"]}
    assert "A2" in uids
    assert "A1" not in uids


def test_list_bbox_filters_spatially(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="INSIDE", coords=(-76.45, 39.32))
    make_asset(tenant, class_code="WAT_HYD", asset_uid="OUTSIDE", coords=(-100.0, 30.0))
    db.session.commit()
    body = admin_client.get("/api/v1/assets?bbox=-76.5,39.3,-76.4,39.4").get_json()
    uids = {a["asset_uid"] for a in body["items"]}
    assert "INSIDE" in uids
    assert "OUTSIDE" not in uids


def test_list_bbox_invalid_422(admin_client):
    resp = admin_client.get("/api/v1/assets?bbox=garbage")
    assert resp.status_code == 422


def test_list_search_q(admin_client, tenant):
    make_asset(tenant, asset_uid="HYD-A1", material="ductile iron")
    make_asset(tenant, asset_uid="HYD-A2", material="PVC")
    db.session.commit()
    body = admin_client.get("/api/v1/assets?q=ductile").get_json()
    uids = {a["asset_uid"] for a in body["items"]}
    assert "HYD-A1" in uids
    assert "HYD-A2" not in uids


def test_pagination(admin_client, tenant):
    for i in range(5):
        make_asset(tenant, asset_uid=f"P-{i}")
    db.session.commit()
    body = admin_client.get("/api/v1/assets?page=1&page_size=2").get_json()
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["items"]) == 2
    assert body["total"] >= 5


def test_tech_cannot_create(tech_client):
    resp = tech_client.post("/api/v1/assets", json={"class_code": "WAT_HYD", "geometry": POINT})
    assert resp.status_code == 403


def test_tech_can_view(tech_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-VIEW")
    db.session.commit()
    resp = tech_client.get("/api/v1/assets/HYD-VIEW")
    assert resp.status_code == 200


def test_supervisor_can_create(supervisor_client):
    resp = supervisor_client.post(
        "/api/v1/assets", json={"class_code": "WAT_HYD", "geometry": POINT}
    )
    assert resp.status_code == 201


def test_unauthenticated_401(client):
    resp = client.get("/api/v1/assets")
    assert resp.status_code == 401


def test_attrs_jsonschema_validation(admin_client, tenant):
    # Patch asset_class to require a 'flow_lps' integer attr
    cls = db.session.get(AssetClass, "WAT_HYD")
    cls.attribute_schema = {
        "type": "object",
        "required": ["flow_lps"],
        "properties": {"flow_lps": {"type": "integer"}},
    }
    db.session.commit()

    bad = admin_client.post(
        "/api/v1/assets",
        json={"class_code": "WAT_HYD", "geometry": POINT, "attrs": {}},
    )
    assert bad.status_code == 422
    assert bad.get_json()["error"]["code"] == "attrs_invalid"

    good = admin_client.post(
        "/api/v1/assets",
        json={
            "class_code": "WAT_HYD",
            "geometry": POINT,
            "attrs": {"flow_lps": 42},
        },
    )
    assert good.status_code == 201


def test_check_constraint_blocks_bad_condition(admin_client):
    resp = admin_client.post(
        "/api/v1/assets",
        json={"class_code": "WAT_HYD", "geometry": POINT, "condition": 7},
    )
    assert resp.status_code == 422


def test_cross_tenant_uid_returns_404(app, client, admin_user):
    other = make_tenant(slug="globex", name="Globex Inc")
    make_user(other, email="ghost@globex.io", role_codes=["admin"])
    make_asset(other, class_code="WAT_HYD", asset_uid="HYD-OTHER")
    db.session.commit()

    login_client(client, "acme", "admin@acme.io")
    resp = client.get("/api/v1/assets/HYD-OTHER")
    assert resp.status_code == 404


def test_cross_tenant_list_isolation(app, client, admin_user):
    other = make_tenant(slug="globex", name="Globex Inc")
    make_user(other, email="ghost@globex.io", role_codes=["admin"])
    make_asset(other, class_code="WAT_HYD", asset_uid="HYD-OTHER-LIST")
    db.session.commit()

    login_client(client, "acme", "admin@acme.io")
    body = client.get("/api/v1/assets").get_json()
    uids = {a["asset_uid"] for a in body["items"]}
    assert "HYD-OTHER-LIST" not in uids


def test_audit_log_created_on_asset_create(admin_client):
    admin_client.post("/api/v1/assets", json={"class_code": "WAT_HYD", "geometry": POINT})
    asset = db.session.scalars(select(Asset).limit(1)).first()
    assert asset is not None

    history = admin_client.get(f"/api/v1/assets/{asset.asset_uid}/history").get_json()
    assert any(entry["action"] == "create" for entry in history["items"])


def test_audit_log_captures_diff_on_patch(admin_client, tenant):
    asset = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-DIFF")
    db.session.commit()
    admin_client.patch(
        f"/api/v1/assets/{asset.asset_uid}",
        json={"material": "PVC"},
    )
    history = admin_client.get(f"/api/v1/assets/{asset.asset_uid}/history").get_json()
    update_entries = [e for e in history["items"] if e["action"] == "update"]
    assert update_entries, history
    diff = update_entries[0]
    assert diff["after"]["material"] == "PVC"
