from __future__ import annotations

from flask import Blueprint, current_app, jsonify

from app.schemas.asset import (
    AssetClassRead,
    AssetCreate,
    AssetHistoryEntry,
    AssetHistoryResponse,
    AssetListResponse,
    AssetRead,
    AssetUpdate,
)
from app.schemas.auth import (
    LoginRequest,
    PasswordChangeRequest,
    RegisterTenantRequest,
)
from app.schemas.tenant import TenantRead, TenantUpdate
from app.schemas.user import (
    RoleRead,
    UserCreate,
    UserListResponse,
    UserRead,
    UserRolesUpdate,
    UserUpdate,
)

openapi_bp = Blueprint("openapi", __name__, url_prefix="/api/v1")


def _flatten_defs(schema, registry: dict) -> None:
    """Walk a JSON-Schema doc, popping every nested `$defs` and registering
    them top-level. Required because Pydantic 2 emits nested $defs (e.g.
    geojson-pydantic types) but OpenAPI tools resolve $ref against the
    document-level components map."""
    if isinstance(schema, dict):
        defs = schema.pop("$defs", None)
        if defs:
            for sub_name, sub_schema in defs.items():
                registry.setdefault(sub_name, sub_schema)
                _flatten_defs(sub_schema, registry)
        for value in schema.values():
            _flatten_defs(value, registry)
    elif isinstance(schema, list):
        for item in schema:
            _flatten_defs(item, registry)


_SCHEMAS = [
    LoginRequest,
    PasswordChangeRequest,
    RegisterTenantRequest,
    TenantRead,
    TenantUpdate,
    RoleRead,
    UserCreate,
    UserListResponse,
    UserRead,
    UserRolesUpdate,
    UserUpdate,
    AssetClassRead,
    AssetCreate,
    AssetHistoryEntry,
    AssetHistoryResponse,
    AssetListResponse,
    AssetRead,
    AssetUpdate,
]


@openapi_bp.get("/openapi.json")
def openapi_spec():
    """Minimal OpenAPI 3.1 doc — components.schemas only.

    Path-level coverage is deferred (S3+); for now the frontend uses
    `openapi-typescript` to generate type defs from this spec, then
    references them in hand-written `features/*/api.ts` wrappers.
    """
    settings = current_app.config["SETTINGS"]
    schemas: dict = {}
    for model in _SCHEMAS:
        schema = model.model_json_schema(ref_template="#/components/schemas/{model}")
        _flatten_defs(schema, schemas)
        schemas[model.__name__] = schema
    return jsonify(
        {
            "openapi": "3.1.0",
            "info": {
                "title": "FlowOps API",
                "version": settings.git_sha or "dev",
            },
            "components": {"schemas": schemas},
            "paths": {},
        }
    )
