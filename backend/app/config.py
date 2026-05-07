from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = Field(default="development")
    secret_key: str = Field(default="dev-secret-do-not-use-in-prod")
    database_url: str = Field(
        default="postgresql+psycopg://citywater:citywater@localhost:5432/citywater",
    )
    # Auto-populated on Railway deployments (RAILWAY_GIT_COMMIT_SHA is
    # injected by the platform); operators can override by setting
    # GIT_SHA explicitly. Falls back to "dev" for local dev.
    git_sha: str = Field(default="dev")
    railway_git_commit_sha: str = Field(default="")

    @property
    def effective_git_sha(self) -> str:
        if self.git_sha and self.git_sha != "dev":
            return self.git_sha
        if self.railway_git_commit_sha:
            return self.railway_git_commit_sha[:12]
        return self.git_sha
    log_level: str = Field(default="INFO")

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        """Railway / Heroku / managed Postgres providers typically
        inject the URL with the bare `postgresql://` (or legacy
        `postgres://`) scheme. SQLAlchemy 2 with psycopg(3) requires
        the explicit dialect prefix, so normalise here rather than
        asking every operator to hand-edit the env value before paste."""
        if v.startswith("postgresql+"):
            return v
        if v.startswith("postgresql://"):
            return "postgresql+psycopg://" + v[len("postgresql://") :]
        if v.startswith("postgres://"):
            return "postgresql+psycopg://" + v[len("postgres://") :]
        return v

    # S12 — hardening
    # Empty string falls back to in-memory limiter (dev only).
    redis_url: str = Field(default="")
    rate_limit_login: str = Field(default="10 per minute")
    rate_limit_register: str = Field(default="5 per minute")
    rate_limit_invite_accept: str = Field(default="20 per minute")
    # Email driver: "stdout" (logs the URL) or "resend".
    email_provider: str = Field(default="stdout")
    resend_api_key: str = Field(default="")
    email_from: str = Field(default="CityWater <noreply@citywater.local>")
    public_base_url: str = Field(default="")
