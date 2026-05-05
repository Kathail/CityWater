from __future__ import annotations


def test_openapi_spec_lists_known_schemas(client):
    resp = client.get("/api/v1/openapi.json")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["openapi"].startswith("3.")
    schemas = body["components"]["schemas"]
    for expected in [
        "LoginRequest",
        "AssetCreate",
        "AssetRead",
        "AssetClassRead",
        "UserRead",
        "TenantRead",
    ]:
        assert expected in schemas, f"missing schema: {expected}"
