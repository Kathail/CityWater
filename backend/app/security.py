"""Security middleware: CSP, HSTS, X-Frame-Options, request IDs.

The CSP is intentionally tight. Notable allowances:
- `connect-src 'self'` — covers /api and the SW's runtime cache; no third-
  party APIs are permitted client-side.
- `img-src 'self' data: blob: https://*.tile.openstreetmap.org` —
  raster basemap tiles render via OSM in S3.
- `worker-src 'self' blob:` — vite-plugin-pwa's service worker plus any
  MapLibre worker chunks bundled by Vite.
- `style-src 'self' 'unsafe-inline'` — Tailwind's compiled CSS doesn't
  need inline, but MapLibre injects a few inline styles for popups; we
  accept that exposure for v1 and revisit in v2 with a nonce.
- HSTS only set when the request is HTTPS or the environment is
  production; we skip it in dev so localhost http works.
"""

from __future__ import annotations

import logging
import uuid

from flask import Flask, Response, g, request

logger = logging.getLogger(__name__)

CSP = "; ".join(
    [
        "default-src 'self'",
        "img-src 'self' data: blob: https://*.tile.openstreetmap.org "
        "https://server.arcgisonline.com https://*.basemaps.cartocdn.com",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "upgrade-insecure-requests",
    ]
)

PERMISSIONS_POLICY = ", ".join(
    [
        # Field PWAs need geolocation + camera (photo capture w/ EXIF).
        "geolocation=(self)",
        "camera=(self)",
        "microphone=()",
        "payment=()",
        "usb=()",
        "interest-cohort=()",
    ]
)


def _is_secure() -> bool:
    if request.is_secure:
        return True
    fwd = request.headers.get("X-Forwarded-Proto", "")
    return fwd.lower() == "https"


def install(app: Flask) -> None:
    @app.before_request
    def _assign_request_id() -> None:
        # Honor an upstream request ID if a load balancer set one, so a
        # single trace can be correlated end-to-end. Otherwise mint our own.
        incoming = request.headers.get("X-Request-ID")
        g.request_id = incoming if incoming else uuid.uuid4().hex

    @app.after_request
    def _security_headers(resp: Response) -> Response:
        resp.headers.setdefault("Content-Security-Policy", CSP)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
        resp.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        resp.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if app.config.get("SETTINGS") and (
            app.config["SETTINGS"].environment == "production" or _is_secure()
        ):
            # 1 year HSTS, no preload by default — operator opts in.
            resp.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        # Always echo the request ID so clients can quote it in support tickets.
        if hasattr(g, "request_id"):
            resp.headers.setdefault("X-Request-ID", g.request_id)
        return resp

    @app.after_request
    def _log_request(resp: Response) -> Response:
        # Single structured line per request — request_id makes 500s findable.
        logger.info(
            "request",
            extra={
                "request_id": getattr(g, "request_id", None),
                "method": request.method,
                "path": request.path,
                "status": resp.status_code,
                "remote": request.remote_addr,
            },
        )
        return resp
