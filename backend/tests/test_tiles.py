from __future__ import annotations

from app.extensions import db
from tests.conftest import login_client, make_asset, make_tenant, make_user


def test_tile_layers_returns_one_per_class(admin_client):
    resp = admin_client.get("/api/v1/tile-layers")
    assert resp.status_code == 200
    body = resp.get_json()
    assert len(body) == 23
    hyd = next(layer for layer in body if layer["class_code"] == "WAT_HYD")
    assert hyd["id"] == "assets-wat-hyd"
    assert hyd["domain"] == "water"
    assert hyd["filter"] == ["==", ["get", "class_code"], "WAT_HYD"]


def test_tile_layers_unauthenticated_401(client):
    resp = client.get("/api/v1/tile-layers")
    assert resp.status_code == 401


def test_assets_tile_returns_mvt(admin_client, tenant):
    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-MVT", coords=(-76.5, 39.3))
    db.session.commit()
    resp = admin_client.get("/api/v1/tiles/assets/0/0/0.pbf")
    assert resp.status_code == 200
    assert resp.mimetype == "application/vnd.mapbox-vector-tile"
    assert "private" in resp.headers["Cache-Control"]


def test_assets_tile_empty_when_no_assets(admin_client, tenant):
    resp = admin_client.get("/api/v1/tiles/assets/0/0/0.pbf")
    assert resp.status_code == 200
    assert resp.data == b""


def test_assets_tile_unauthenticated_401(client):
    resp = client.get("/api/v1/tiles/assets/0/0/0.pbf")
    assert resp.status_code == 401


def test_assets_tile_invalid_coords_400(admin_client):
    # x out of range for zoom 0 (only one tile at z=0: (0,0))
    resp = admin_client.get("/api/v1/tiles/assets/0/5/0.pbf")
    assert resp.status_code == 400


def test_assets_tile_zoom_too_high_400(admin_client):
    resp = admin_client.get("/api/v1/tiles/assets/30/0/0.pbf")
    assert resp.status_code == 400


def test_assets_tile_isolates_tenants(app, client, admin_user):
    other = make_tenant(slug="globex", name="Globex Inc")
    make_user(other, email="ghost@globex.io", role_codes=["admin"])
    make_asset(other, class_code="WAT_HYD", asset_uid="HYD-OTHER-T", coords=(-76.5, 39.3))
    make_asset(
        admin_user.__class__.__mro__[0] is None and None or None, class_code=None
    ) if False else None  # noqa
    db.session.commit()

    # Login as acme admin — they should NOT see globex's asset in their tile
    login_client(client, "acme", "admin@acme.io")
    resp = client.get("/api/v1/tiles/assets/0/0/0.pbf")
    assert resp.status_code == 200
    # acme has zero assets → tile is empty
    assert resp.data == b""


def test_assets_tile_excludes_soft_deleted(admin_client, tenant):
    asset = make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-DEL", coords=(-76.5, 39.3))
    from datetime import UTC, datetime

    asset.deleted_at = datetime.now(UTC)
    db.session.commit()

    resp = admin_client.get("/api/v1/tiles/assets/0/0/0.pbf")
    assert resp.data == b""
