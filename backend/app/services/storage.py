from __future__ import annotations

import re
import uuid
from typing import BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from flask import current_app

from app.config import Settings


def _settings() -> Settings:
    return current_app.config["SETTINGS"]


def _client():
    """Build a boto3 S3 client for MinIO (dev) / B2 / R2 / AWS S3 (prod).

    All values come from `Settings` (pydantic-settings) per CLAUDE.md.
    Path-style addressing is the default for MinIO/B2 compat.
    """
    s = _settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint or None,
        region_name=s.s3_region,
        aws_access_key_id=s.s3_access_key or None,
        aws_secret_access_key=s.s3_secret_key or None,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if s.s3_force_path_style else "auto"},
        ),
    )


def _bucket() -> str:
    return _settings().s3_bucket


_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_name(filename: str) -> str:
    """Strip everything but alnum, dot, underscore, dash so the S3 key tail
    can't contain control characters or path-traversal payloads."""
    cleaned = _FILENAME_SAFE.sub("_", filename)
    # Avoid leading dots that would create dotfiles in any S3 browser.
    cleaned = cleaned.lstrip(".") or "file"
    return cleaned[:120]  # bound length


def upload_attachment(
    file_obj: BinaryIO,
    *,
    tenant_id: int,
    work_order_id: int,
    filename: str,
    content_type: str,
) -> str:
    """Upload to S3 under tenants/{tenant}/work-orders/{wo}/{uuid}-{filename}.
    Returns the S3 key."""
    safe_name = _safe_name(filename)
    key = f"tenants/{tenant_id}/work-orders/{work_order_id}/{uuid.uuid4().hex[:12]}-{safe_name}"
    s3 = _client()
    s3.upload_fileobj(
        file_obj,
        _bucket(),
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return key


def presigned_download_url(
    s3_key: str,
    *,
    expires_in: int | None = None,
    download_filename: str | None = None,
) -> str:
    """Pre-sign a GET URL with `Content-Disposition: attachment` forced.

    Defense-in-depth on top of the upload-time MIME allowlist (WO-P0-5):
    even if a malicious file slips through, browsers must download
    rather than render inline (no XSS via `image/svg+xml`,
    `text/html` mislabelled as something else, etc.).
    """
    s3 = _client()
    params: dict[str, str | int] = {
        "Bucket": _bucket(),
        "Key": s3_key,
    }
    if download_filename is not None:
        # Quote awkward chars; S3 re-encodes per RFC 6266.
        safe = _safe_name(download_filename)
        params["ResponseContentDisposition"] = f'attachment; filename="{safe}"'
    else:
        params["ResponseContentDisposition"] = "attachment"
    return s3.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=expires_in if expires_in is not None else _settings().s3_presign_expiry_seconds,
    )


def ensure_bucket() -> None:
    """Create the bucket if it doesn't exist (idempotent). Used by tests + first-run."""
    s3 = _client()
    try:
        s3.head_bucket(Bucket=_bucket())
    except ClientError:
        # 404/403 from head_bucket → bucket missing. Other ClientError
        # surfaces (auth, network) propagate naturally so the operator
        # sees the real cause.
        s3.create_bucket(Bucket=_bucket())
