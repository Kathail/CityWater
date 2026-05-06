from __future__ import annotations

import os
import uuid
from typing import BinaryIO

import boto3
from botocore.client import Config


def _client():
    """Build a boto3 S3 client for MinIO (dev) / B2 / R2 / AWS S3 (prod).

    Configured via env: S3_ENDPOINT_URL, S3_REGION, S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY. Path-style addressing is used for MinIO compat.
    """
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _bucket() -> str:
    return os.environ.get("S3_BUCKET", "flowops-attachments")


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
    safe_name = filename.replace("/", "_").replace("\\", "_")
    key = f"tenants/{tenant_id}/work-orders/{work_order_id}/{uuid.uuid4().hex[:12]}-{safe_name}"
    s3 = _client()
    s3.upload_fileobj(
        file_obj,
        _bucket(),
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return key


def presigned_download_url(s3_key: str, expires_in: int = 600) -> str:
    s3 = _client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": _bucket(), "Key": s3_key},
        ExpiresIn=expires_in,
    )


def ensure_bucket() -> None:
    """Create the bucket if it doesn't exist (idempotent). Used by tests + first-run."""
    s3 = _client()
    try:
        s3.head_bucket(Bucket=_bucket())
    except Exception:
        s3.create_bucket(Bucket=_bucket())
