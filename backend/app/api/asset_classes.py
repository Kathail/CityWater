from __future__ import annotations

from flask import Blueprint, jsonify
from flask_login import login_required
from sqlalchemy import select

from app.errors import NotFoundError
from app.extensions import db
from app.models import AssetClass
from app.schemas.asset import AssetClassRead

asset_classes_bp = Blueprint("asset_classes", __name__, url_prefix="/api/v1/asset-classes")


def _payload(ac: AssetClass) -> dict:
    return AssetClassRead.model_validate(ac).model_dump(mode="json")


@asset_classes_bp.get("")
@login_required
def list_asset_classes():
    items = db.session.scalars(
        select(AssetClass)
        .order_by(AssetClass.domain, AssetClass.code)
        .execution_options(skip_tenant_filter=True)
    ).all()
    return jsonify([_payload(ac) for ac in items])


@asset_classes_bp.get("/<string:code>")
@login_required
def get_asset_class(code: str):
    ac = db.session.get(AssetClass, code)
    if not ac:
        raise NotFoundError(f"asset class {code} not found")
    return jsonify(_payload(ac))
