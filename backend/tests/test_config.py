from __future__ import annotations

import pytest

from app.config import Settings


@pytest.mark.parametrize(
    "raw, expected",
    [
        # Already correct — leave alone.
        (
            "postgresql+psycopg://u:p@h:5432/db",
            "postgresql+psycopg://u:p@h:5432/db",
        ),
        # Railway / managed-Postgres style.
        (
            "postgresql://u:p@host.railway.internal:5432/railway",
            "postgresql+psycopg://u:p@host.railway.internal:5432/railway",
        ),
        # Heroku / older style.
        (
            "postgres://u:p@h:5432/db",
            "postgresql+psycopg://u:p@h:5432/db",
        ),
        # Other dialect prefixes are untouched (e.g. asyncpg, even
        # though we don't use it — guard against regressions).
        (
            "postgresql+asyncpg://u:p@h:5432/db",
            "postgresql+asyncpg://u:p@h:5432/db",
        ),
        # Unknown scheme — pass through (let SQLAlchemy raise).
        ("sqlite:///./dev.db", "sqlite:///./dev.db"),
    ],
)
def test_database_url_normalisation(monkeypatch, raw: str, expected: str) -> None:
    """The `database_url` validator rewrites bare postgres(ql) URLs to
    the `postgresql+psycopg://` dialect SQLAlchemy 2 needs, so operators
    can paste Railway/Heroku DATABASE_URL values straight into env."""
    monkeypatch.setenv("DATABASE_URL", raw)
    monkeypatch.setenv("SECRET_KEY", "test")
    s = Settings(_env_file=None)  # type: ignore[arg-type]
    assert s.database_url == expected
