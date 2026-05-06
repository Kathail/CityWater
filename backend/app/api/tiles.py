from __future__ import annotations

from flask import Blueprint, Response, abort, jsonify
from flask_login import current_user, login_required
from sqlalchemy import bindparam, func, select

from app.extensions import db
from app.models import AssetClass

tiles_bp = Blueprint("tiles", __name__, url_prefix="/api/v1")


def _layer_id(class_code: str) -> str:
    return f"assets-{class_code.lower().replace('_', '-')}"


@tiles_bp.get("/tile-layers")
@login_required
def list_tile_layers():
    """One MapLibre style-layer per asset class. All layers point at the same
    vector source `/api/v1/tiles/assets/{z}/{x}/{y}.pbf` and use a class_code
    filter, so a single tile fetch populates every layer."""
    classes = db.session.scalars(
        select(AssetClass)
        .order_by(AssetClass.domain, AssetClass.code)
        .execution_options(skip_tenant_filter=True)
    ).all()
    return jsonify(
        [
            {
                "id": _layer_id(c.code),
                "class_code": c.code,
                "domain": c.domain,
                "name": c.name,
                "geometry_type": c.geometry_type,
                "color": c.color,
                "icon": c.icon,
                "source": "assets",
                "source_layer": "assets",
                "filter": ["==", ["get", "class_code"], c.code],
            }
            for c in classes
        ]
    )


@tiles_bp.get("/tiles/assets/<int:z>/<int:x>/<int:y>.pbf")
@login_required
def get_assets_tile(z: int, x: int, y: int):
    if z < 0 or z > 24 or x < 0 or y < 0 or x >= (1 << z) or y >= (1 << z):
        abort(400)

    stmt = select(
        func.assets_mvt(
            bindparam("tenant_id", current_user.tenant_id),
            bindparam("z", z),
            bindparam("x", x),
            bindparam("y", y),
        )
    )
    row = db.session.execute(stmt).scalar_one()
    body = bytes(row) if row is not None else b""
    return Response(
        body,
        mimetype="application/vnd.mapbox-vector-tile",
        headers={
            # private = browser-only cache; tenant data should never hit a shared CDN
            "Cache-Control": "private, max-age=60",
            "Content-Length": str(len(body)),
        },
    )
