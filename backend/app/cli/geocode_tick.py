"""`flask geocode-tick` — drain the asset geocode queue.

Cron entry-point. Runs every few minutes in production. Bypasses tenant
filter to span every tenant.
"""

from __future__ import annotations

import click
from flask import Flask
from flask.cli import with_appcontext

from app.services.geocode_worker import tick


def register(app: Flask) -> None:
    @app.cli.command("geocode-tick")
    @click.option("--batch", default=100, help="Maximum rows to process this tick.")
    @with_appcontext
    def geocode_tick(batch: int) -> None:
        summary = tick(batch_size=batch)
        click.echo(
            f"[geocode-tick] processed={summary['processed']} geocoded={summary['geocoded']} failed={summary['failed']}"
        )
