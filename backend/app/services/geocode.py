from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_S = 5.0
_USER_AGENT = "FlowOps/0.1 (+https://github.com/Kathail/CityWater)"


def reverse_geocode(address: str) -> tuple[float, float] | None:
    """Resolve `address` to (lon, lat) using Nominatim.

    Returns None if `NOMINATIM_URL` is unset, the address is empty, or the
    upstream call fails. Callers should treat None as 'unable to resolve'
    and require the intake form to provide coords manually.

    `NOMINATIM_URL` example: https://nominatim.openstreetmap.org (no trailing
    slash). Public instance has a 1 req/s policy; do not call from a tight
    loop. For production wire a self-hosted instance.
    """
    base = os.environ.get("NOMINATIM_URL", "").rstrip("/")
    if not base or not address.strip():
        return None

    params: dict[str, Any] = {
        "q": address.strip(),
        "format": "jsonv2",
        "limit": 1,
    }
    url = f"{base}/search?{urlencode(params)}"
    try:
        resp = httpx.get(url, timeout=_TIMEOUT_S, headers={"User-Agent": _USER_AGENT})
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("nominatim lookup failed for address=%r", address, exc_info=True)
        return None

    if not isinstance(data, list) or not data:
        return None
    first = data[0]
    try:
        lon = float(first["lon"])
        lat = float(first["lat"])
    except (KeyError, TypeError, ValueError):
        return None
    return lon, lat
