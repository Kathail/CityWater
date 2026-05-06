"""Email dispatch with a tiny driver interface.

Drivers:
- `stdout` (default): logs the recipient + URL. Sufficient for v1, and the
  invitation API also surfaces the accept URL in the response so the admin
  can copy/paste while we're between providers.
- `resend`: posts to the Resend HTTP API when `RESEND_API_KEY` is set.
  Wired but not exercised in CI; flip the env in production.

A driver is chosen at call time (not boot time) so a tenant settings change
or env reload picks up immediately without an app restart.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx
from flask import current_app

logger = logging.getLogger(__name__)


class EmailDriver(Protocol):
    def send(self, *, to: str, subject: str, html: str, text: str) -> None: ...


class StdoutDriver:
    """Dev/v1 driver — logs the email instead of sending it."""

    def send(self, *, to: str, subject: str, html: str, text: str) -> None:
        logger.info(
            "email[stdout] to=%s subject=%r body=%r",
            to,
            subject,
            text,
        )


class ResendDriver:
    """Resend HTTP API driver — production target per SPEC §10 Q2."""

    def __init__(self, api_key: str, sender: str) -> None:
        self._api_key = api_key
        self._sender = sender

    def send(self, *, to: str, subject: str, html: str, text: str) -> None:
        try:
            resp = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": self._sender,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                    "text": text,
                },
                timeout=10.0,
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("email[resend] send failed to=%s subject=%r", to, subject)
            raise


def _driver() -> EmailDriver:
    settings = current_app.config["SETTINGS"]
    if settings.email_provider == "resend":
        if not settings.resend_api_key:
            logger.warning(
                "email_provider=resend but RESEND_API_KEY unset — falling back to stdout"
            )
            return StdoutDriver()
        return ResendDriver(api_key=settings.resend_api_key, sender=settings.email_from)
    return StdoutDriver()


def send_invitation_email(*, to: str, accept_url: str, tenant_name: str) -> None:
    subject = f"You're invited to {tenant_name} on FlowOps"
    text = (
        f"You've been invited to join {tenant_name} on FlowOps.\n\n"
        f"Accept your invitation:\n{accept_url}\n\n"
        f"This link expires soon. If you didn't expect this, ignore this email."
    )
    html = (
        f"<p>You've been invited to join <strong>{tenant_name}</strong> on FlowOps.</p>"
        f'<p><a href="{accept_url}">Accept your invitation</a></p>'
        f"<p>If you didn't expect this, ignore this email.</p>"
    )
    _driver().send(to=to, subject=subject, html=html, text=text)
