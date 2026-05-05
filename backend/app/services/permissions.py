from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask_login import current_user

from app.errors import ForbiddenError


def require_roles(*role_codes: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator: 403 unless current_user has at least one of the given role codes.

    Stack inside @login_required so unauthenticated requests get 401 first:

        @bp.post("/things")
        @login_required
        @require_roles("admin", "supervisor")
        def create_thing():
            ...
    """

    def decorator(view_func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view_func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            user = current_user._get_current_object()
            if not any(role.code in role_codes for role in user.roles):
                raise ForbiddenError(f"requires role: {' or '.join(role_codes)}")
            return view_func(*args, **kwargs)

        return wrapper

    return decorator
