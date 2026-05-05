from __future__ import annotations

import os

import pytest
from flask import g
from flask_migrate import upgrade as flask_migrate_upgrade
from pytest_postgresql import factories
from sqlalchemy import select

from app import create_app
from app.config import Settings
from app.extensions import db as _db
from app.models import Asset, Role, Tenant, User, UserRole
from app.services.auth import hash_password
from app.services.geometry import geojson_to_wkb
from app.utils.uids import generate_user_uid

_PG_HOST = os.environ.get("PGHOST", "localhost")
_PG_PORT = int(os.environ.get("PGPORT", "5432"))
_PG_USER = os.environ.get("PGUSER", "flowops")
_PG_PASSWORD = os.environ.get("PGPASSWORD", "flowops")

postgresql_proc = factories.postgresql_noproc(
    host=_PG_HOST,
    port=_PG_PORT,
    user=_PG_USER,
    password=_PG_PASSWORD,
)
postgresql = factories.postgresql("postgresql_proc")

DEFAULT_PASSWORD = "TestPassword123!"


@pytest.fixture
def app(postgresql):
    info = postgresql.info
    url = f"postgresql+psycopg://{info.user}:{_PG_PASSWORD}@{info.host}:{info.port}/{info.dbname}"
    settings = Settings(database_url=url, environment="test", git_sha="test-sha")
    flask_app = create_app(settings)
    flask_app.config["WTF_CSRF_ENABLED"] = False
    with flask_app.app_context():
        # Run real migrations so schema + seeds match production behavior.
        flask_migrate_upgrade()
        yield flask_app


@pytest.fixture
def client(app):
    return app.test_client()


def make_tenant(slug: str = "acme", name: str = "Acme Water") -> Tenant:
    g.skip_tenant_filter = True
    tenant = Tenant(name=name, slug=slug, settings={})
    _db.session.add(tenant)
    _db.session.flush()
    role_defs = [
        ("admin", "Administrator"),
        ("supervisor", "Supervisor"),
        ("tech", "Field tech"),
        ("readonly", "Read only"),
        ("intake", "Service intake"),
    ]
    for code, role_name in role_defs:
        _db.session.add(Role(tenant_id=tenant.id, code=code, name=role_name))
    _db.session.flush()
    return tenant


def make_user(
    tenant: Tenant,
    *,
    email: str = "user@acme.io",
    password: str = DEFAULT_PASSWORD,
    full_name: str = "Test User",
    role_codes: list[str] | None = None,
    is_active: bool = True,
) -> User:
    g.skip_tenant_filter = True
    user = User(
        tenant_id=tenant.id,
        user_uid=generate_user_uid(),
        email=email,
        password_hash=hash_password(password),
        full_name=full_name,
        is_active=is_active,
    )
    _db.session.add(user)
    _db.session.flush()
    if role_codes:
        roles = _db.session.scalars(
            select(Role).where(Role.tenant_id == tenant.id, Role.code.in_(role_codes))
        ).all()
        for r in roles:
            _db.session.add(UserRole(user_id=user.id, role_id=r.id))
        _db.session.flush()
    return user


def make_asset(
    tenant: Tenant,
    *,
    class_code: str = "WAT_HYD",
    asset_uid: str | None = None,
    coords: tuple[float, float] = (-76.5, 39.3),
    **fields,
) -> Asset:
    """Default geometry is a Point in the Chesapeake Bay area (real-ish coords)."""
    g.skip_tenant_filter = True
    if asset_uid is None:
        asset_uid = f"TST-{generate_user_uid()[:8]}"
    geom = geojson_to_wkb({"type": "Point", "coordinates": list(coords)})
    fields.setdefault("status", "active")
    asset = Asset(
        tenant_id=tenant.id,
        asset_uid=asset_uid,
        class_code=class_code,
        geom=geom,
        **fields,
    )
    _db.session.add(asset)
    _db.session.flush()
    return asset


@pytest.fixture
def tenant(app):
    t = make_tenant()
    _db.session.commit()
    return t


@pytest.fixture
def admin_user(app, tenant):
    user = make_user(tenant, email="admin@acme.io", role_codes=["admin"])
    _db.session.commit()
    return user


@pytest.fixture
def supervisor_user(app, tenant):
    user = make_user(tenant, email="sup@acme.io", role_codes=["supervisor"])
    _db.session.commit()
    return user


@pytest.fixture
def tech_user(app, tenant):
    user = make_user(tenant, email="tech@acme.io", role_codes=["tech"])
    _db.session.commit()
    return user


def login_client(client, slug: str, email: str, password: str = DEFAULT_PASSWORD):
    resp = client.post(
        "/api/v1/auth/login",
        json={"tenant_slug": slug, "email": email, "password": password},
    )
    assert resp.status_code == 200, resp.get_json()
    return resp


@pytest.fixture
def admin_client(app, admin_user):
    c = app.test_client()
    login_client(c, "acme", "admin@acme.io")
    return c


@pytest.fixture
def supervisor_client(app, supervisor_user):
    c = app.test_client()
    login_client(c, "acme", "sup@acme.io")
    return c


@pytest.fixture
def tech_client(app, tech_user):
    c = app.test_client()
    login_client(c, "acme", "tech@acme.io")
    return c
