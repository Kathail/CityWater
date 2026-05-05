from __future__ import annotations


def test_list_returns_23_seeded_classes(admin_client):
    resp = admin_client.get("/api/v1/asset-classes")
    assert resp.status_code == 200
    body = resp.get_json()
    assert len(body) == 23
    codes = {c["code"] for c in body}
    assert {"WAT_HYD", "SAN_MH", "STM_CB", "WAT_MAIN", "STM_BMP"}.issubset(codes)


def test_classes_have_correct_domain_and_geometry_type(admin_client):
    body = admin_client.get("/api/v1/asset-classes").get_json()
    by_code = {c["code"]: c for c in body}
    assert by_code["WAT_HYD"]["domain"] == "water"
    assert by_code["WAT_HYD"]["geometry_type"] == "Point"
    assert by_code["SAN_MAIN"]["domain"] == "sewer"
    assert by_code["SAN_MAIN"]["geometry_type"] == "LineString"
    assert by_code["STM_BMP"]["domain"] == "storm"
    assert by_code["STM_BMP"]["geometry_type"] == "Polygon"


def test_get_one_class(admin_client):
    resp = admin_client.get("/api/v1/asset-classes/WAT_HYD")
    assert resp.status_code == 200
    assert resp.get_json()["name"] == "Hydrant"


def test_get_unknown_class_404(admin_client):
    resp = admin_client.get("/api/v1/asset-classes/NOPE")
    assert resp.status_code == 404


def test_unauthenticated_401(client):
    resp = client.get("/api/v1/asset-classes")
    assert resp.status_code == 401


def test_tech_can_view(tech_client):
    resp = tech_client.get("/api/v1/asset-classes")
    assert resp.status_code == 200
