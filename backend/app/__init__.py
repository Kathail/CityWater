from __future__ import annotations

from flask import Flask, g, jsonify
from flask_login import current_user
from flask_wtf.csrf import generate_csrf
from sqlalchemy import select

from app import models  # noqa: F401  populate Base.metadata for migrations + create_all
from app.api.asset_classes import asset_classes_bp
from app.api.assets import assets_bp
from app.api.auth import auth_bp
from app.api.health import health_bp
from app.api.openapi import openapi_bp
from app.api.tenant import tenant_bp
from app.api.tiles import tiles_bp
from app.api.users import users_bp
from app.config import Settings
from app.errors import register_error_handlers
from app.extensions import csrf, db, login_manager, migrate
from app.logging import configure_logging
from app.models import User
from app.services import audit, tenancy  # noqa: F401  register session listeners


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or Settings()
    configure_logging(settings)

    app = Flask(__name__)
    app.config["SETTINGS"] = settings
    app.config["SECRET_KEY"] = settings.secret_key
    app.config["SQLALCHEMY_DATABASE_URI"] = settings.database_url
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
    app.config["SESSION_COOKIE_SECURE"] = settings.environment == "production"
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["WTF_CSRF_TIME_LIMIT"] = None

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    csrf.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str):
        # Bypass the tenant filter — at session-load time, g.tenant_id isn't
        # set yet (we're populating it). Without the bypass, the listener
        # filters out the user we're trying to load.
        return db.session.scalar(
            select(User).where(User.id == int(user_id)).execution_options(skip_tenant_filter=True)
        )

    @login_manager.unauthorized_handler
    def _unauthorized():
        return (
            jsonify(
                {
                    "error": {
                        "code": "unauthorized",
                        "message": "authentication required",
                    }
                }
            ),
            401,
        )

    @app.before_request
    def _set_tenant_context():
        g.skip_tenant_filter = False
        if current_user and current_user.is_authenticated:
            g.tenant_id = current_user.tenant_id
        else:
            g.tenant_id = None

    @app.after_request
    def _set_csrf_cookie(resp):
        if current_user and current_user.is_authenticated:
            resp.set_cookie(
                "XSRF-TOKEN",
                generate_csrf(),
                httponly=False,
                samesite="Lax",
                secure=app.config["SESSION_COOKIE_SECURE"],
            )
        return resp

    register_error_handlers(app)
    app.register_blueprint(health_bp)
    app.register_blueprint(openapi_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(tenant_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(asset_classes_bp)
    app.register_blueprint(assets_bp)
    app.register_blueprint(tiles_bp)

    return app
