from __future__ import annotations

from flask import g, has_request_context
from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.extensions import Base
from app.models.mixins import SoftDeleteMixin, TenantScopedMixin


def _current_tenant_id() -> int | None:
    """Read tenant from g only. before_request is responsible for populating it
    from current_user; the listener must never touch current_user, since that
    triggers Flask-Login's user_loader, which itself runs a SELECT — recursion."""
    if not has_request_context():
        return None
    if getattr(g, "skip_tenant_filter", False):
        return None
    return getattr(g, "tenant_id", None)


def _tenant_scoped_classes() -> list[type]:
    return [m.class_ for m in Base.registry.mappers if issubclass(m.class_, TenantScopedMixin)]


def _soft_delete_classes() -> list[type]:
    return [m.class_ for m in Base.registry.mappers if issubclass(m.class_, SoftDeleteMixin)]


@event.listens_for(Session, "do_orm_execute")
def _apply_tenant_filter(execute_state) -> None:
    if not execute_state.is_select:
        return
    if execute_state.is_relationship_load:
        return
    if execute_state.execution_options.get("skip_tenant_filter"):
        return

    tenant_id = _current_tenant_id()
    if tenant_id is None:
        return

    for cls in _tenant_scoped_classes():
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                cls,
                lambda c, _tid=tenant_id: c.tenant_id == _tid,
                include_aliases=True,
            )
        )


@event.listens_for(Session, "do_orm_execute")
def _apply_soft_delete_filter(execute_state) -> None:
    """Auto-filter `deleted_at IS NULL` for SoftDeleteMixin models. Bypass with
    `execution_options(include_deleted=True)` for admin/audit queries."""
    if not execute_state.is_select:
        return
    if execute_state.is_relationship_load:
        return
    if execute_state.execution_options.get("include_deleted"):
        return

    for cls in _soft_delete_classes():
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                cls,
                lambda c: c.deleted_at.is_(None),
                include_aliases=True,
            )
        )
