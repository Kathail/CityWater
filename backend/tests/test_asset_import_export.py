from __future__ import annotations

import io
import json
import time

from sqlalchemy import select

from app.extensions import db
from app.models import Asset

CSV_HEADER = (
    "class_code,asset_uid,lon,lat,material,diameter_mm,length_m,depth_m,"
    "manufacturer,model,serial_number,install_date,decommission_date,"
    "warranty_until,condition,criticality,status,notes\n"
)


def _post_csv(client, body: str, **form):
    return client.post(
        "/api/v1/assets/import",
        data={**form, "file": (io.BytesIO(body.encode("utf-8")), "in.csv")},
        content_type="multipart/form-data",
    )


def _post_geojson(client, payload: dict, **form):
    return client.post(
        "/api/v1/assets/import",
        data={
            **form,
            "file": (io.BytesIO(json.dumps(payload).encode("utf-8")), "in.geojson"),
        },
        content_type="multipart/form-data",
    )


def test_csv_happy_path(admin_client):
    body = CSV_HEADER + ("WAT_HYD,,-76.5,39.3,ductile iron,150,,,,,,,,,,,,\n")
    resp = admin_client.post(
        "/api/v1/assets/import",
        data={"file": (io.BytesIO(body.encode("utf-8")), "x.csv")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["summary"]["created"] == 1
    assert body["errors"] == []


def test_csv_geometry_unsupported_for_line_class(admin_client):
    body = CSV_HEADER + "WAT_MAIN,,-76.5,39.3,PVC,200,,,,,,,,,,,,\n"
    resp = _post_csv(admin_client, body)
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["summary"]["failed"] == 1
    assert payload["errors"][0]["code"] == "geometry_type_unsupported_in_csv"


def test_csv_unknown_class(admin_client):
    body = CSV_HEADER + "NOPE,,-76.5,39.3,,,,,,,,,,,,,,\n"
    resp = _post_csv(admin_client, body)
    payload = resp.get_json()
    assert payload["summary"]["failed"] == 1
    assert payload["errors"][0]["code"] == "unknown_class"


def test_csv_missing_geometry(admin_client):
    body = CSV_HEADER + "WAT_HYD,,,,,,,,,,,,,,,,,\n"
    resp = _post_csv(admin_client, body)
    payload = resp.get_json()
    assert payload["summary"]["failed"] == 1
    assert payload["errors"][0]["code"] == "missing_geometry"


def test_csv_explicit_uid_skip_default(admin_client):
    body = CSV_HEADER + "WAT_HYD,HYD-X1,-76.5,39.3,,,,,,,,,,,,,,\n"
    resp = _post_csv(admin_client, body)
    assert resp.get_json()["summary"]["created"] == 1

    # Re-import same uid → skipped
    resp2 = _post_csv(admin_client, body)
    payload = resp2.get_json()
    assert payload["summary"]["skipped"] == 1
    assert payload["errors"][0]["code"] == "asset_uid_taken"


def test_csv_explicit_uid_update_mode(admin_client):
    body = CSV_HEADER + "WAT_HYD,HYD-U1,-76.5,39.3,old,,,,,,,,,,,,,\n"
    _post_csv(admin_client, body)

    body2 = CSV_HEADER + "WAT_HYD,HYD-U1,-76.5,39.3,new-material,,,,,,,,,,,,,\n"
    resp = _post_csv(admin_client, body2, on_conflict="update")
    payload = resp.get_json()
    assert payload["summary"]["updated"] == 1

    asset = db.session.scalar(select(Asset).where(Asset.asset_uid == "HYD-U1"))
    assert asset.material == "new-material"


def test_csv_dry_run_writes_nothing(admin_client):
    body = CSV_HEADER + "WAT_HYD,HYD-DRY,-76.5,39.3,,,,,,,,,,,,,,\n"
    resp = _post_csv(admin_client, body, dry_run="true")
    assert resp.get_json()["summary"]["created"] == 1

    # Asset should NOT exist
    asset = db.session.scalar(select(Asset).where(Asset.asset_uid == "HYD-DRY"))
    assert asset is None


def test_csv_partial_failures_continue(admin_client):
    body = CSV_HEADER + (
        "WAT_HYD,,-76.5,39.3,,,,,,,,,,,,,,\n"
        "NOPE,,-76.5,39.3,,,,,,,,,,,,,,\n"
        "WAT_HYD,,-76.6,39.4,,,,,,,,,,,,,,\n"
    )
    resp = _post_csv(admin_client, body)
    payload = resp.get_json()
    assert payload["summary"]["created"] == 2
    assert payload["summary"]["failed"] == 1


def test_csv_utf8_bom_handled(admin_client):
    body = "﻿" + CSV_HEADER + "WAT_HYD,,-76.5,39.3,,,,,,,,,,,,,,\n"
    resp = _post_csv(admin_client, body)
    assert resp.get_json()["summary"]["created"] == 1


def test_geojson_featurecollection_happy(admin_client):
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-76.5, 39.3]},
                "properties": {"class_code": "WAT_HYD", "material": "ductile iron"},
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-76.5, 39.3], [-76.4, 39.35]],
                },
                "properties": {"class_code": "WAT_MAIN"},
            },
            {
                "type": "Feature",
                "geometry": {
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
                },
                "properties": {"class_code": "WAT_RES"},
            },
        ],
    }
    resp = _post_geojson(admin_client, payload)
    body = resp.get_json()
    assert body["summary"]["created"] == 3
    assert body["errors"] == []


def test_geojson_geometry_type_mismatch(admin_client):
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-76.5, 39.3], [-76.4, 39.35]],
                },
                "properties": {"class_code": "WAT_HYD"},
            }
        ],
    }
    resp = _post_geojson(admin_client, payload)
    payload2 = resp.get_json()
    assert payload2["summary"]["failed"] == 1
    assert payload2["errors"][0]["code"] == "geometry_type_mismatch"


def test_geojson_invalid_format_400(admin_client):
    resp = admin_client.post(
        "/api/v1/assets/import",
        data={"file": (io.BytesIO(b"{}"), "x.geojson")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "bad_format"


def test_unsupported_format(admin_client):
    resp = admin_client.post(
        "/api/v1/assets/import",
        data={"file": (io.BytesIO(b"hi"), "x.txt")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "unsupported_format"


def test_import_tech_403(tech_client):
    resp = _post_csv(tech_client, CSV_HEADER)
    assert resp.status_code == 403


def test_import_unauthenticated_401(client):
    resp = _post_csv(client, CSV_HEADER)
    assert resp.status_code == 401


def test_export_geojson(admin_client, tenant):
    from tests.conftest import make_asset

    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-EX1", coords=(-76.5, 39.3))
    db.session.commit()

    resp = admin_client.get("/api/v1/assets/export?format=geojson")
    assert resp.status_code == 200
    assert resp.mimetype == "application/geo+json"
    assert "attachment" in resp.headers["Content-Disposition"]
    payload = json.loads(resp.get_data(as_text=True))
    assert payload["type"] == "FeatureCollection"
    assert any(f["properties"]["asset_uid"] == "HYD-EX1" for f in payload["features"])


def test_export_csv(admin_client, tenant):
    from tests.conftest import make_asset

    make_asset(
        tenant,
        class_code="WAT_HYD",
        asset_uid="HYD-EX2",
        coords=(-76.5, 39.3),
        material="cast iron",
    )
    db.session.commit()

    resp = admin_client.get("/api/v1/assets/export?format=csv")
    assert resp.status_code == 200
    assert resp.mimetype == "text/csv"
    text = resp.get_data(as_text=True)
    lines = text.strip().split("\n")
    assert lines[0].startswith("class_code,asset_uid,lon,lat,")
    assert any("HYD-EX2" in line for line in lines[1:])


def test_export_filters_by_class(admin_client, tenant):
    from tests.conftest import make_asset

    make_asset(tenant, class_code="WAT_HYD", asset_uid="HYD-F1")
    make_asset(tenant, class_code="SAN_MH", asset_uid="MH-F1")
    db.session.commit()

    payload = json.loads(
        admin_client.get("/api/v1/assets/export?format=geojson&class=WAT_HYD").get_data(
            as_text=True
        )
    )
    uids = {f["properties"]["asset_uid"] for f in payload["features"]}
    assert "HYD-F1" in uids
    assert "MH-F1" not in uids


def test_round_trip_geojson(admin_client, tenant):
    from datetime import UTC, datetime

    from tests.conftest import make_asset

    a = make_asset(
        tenant,
        class_code="WAT_HYD",
        asset_uid="HYD-RT1",
        coords=(-76.5, 39.3),
        material="ductile iron",
        diameter_mm=150,
    )
    db.session.commit()

    exported = admin_client.get("/api/v1/assets/export?format=geojson").get_data(as_text=True)

    a.deleted_at = datetime.now(UTC)
    db.session.commit()

    resp = admin_client.post(
        "/api/v1/assets/import",
        data={
            "file": (io.BytesIO(exported.encode("utf-8")), "round.geojson"),
            "on_conflict": "update",
        },
        content_type="multipart/form-data",
    )
    assert resp.get_json()["summary"]["updated"] >= 1
    restored = db.session.scalar(
        select(Asset).where(Asset.asset_uid == "HYD-RT1").execution_options(include_deleted=True)
    )
    assert restored.material == "ductile iron"
    assert restored.diameter_mm == 150


def test_perf_1000_rows_under_10s(admin_client):
    rows = [
        f"WAT_HYD,HYD-PERF-{i:05d},{-76.5 + i * 0.0001},{39.3},,,,,,,,,,,,,," for i in range(1000)
    ]
    body = CSV_HEADER + "\n".join(rows) + "\n"

    start = time.perf_counter()
    resp = _post_csv(admin_client, body)
    elapsed = time.perf_counter() - start
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["summary"]["created"] == 1000
    assert elapsed < 10.0, f"import took {elapsed:.2f}s (>10s)"


def test_max_file_size_413(admin_client):
    # 10 MB + 1 byte
    big = b"a" * (10 * 1024 * 1024 + 1)
    resp = admin_client.post(
        "/api/v1/assets/import",
        data={"file": (io.BytesIO(big), "huge.csv")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 413
