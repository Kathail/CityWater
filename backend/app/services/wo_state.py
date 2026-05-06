from __future__ import annotations

from app.errors import ConflictError

# Per docs/SPEC.md §3.5 — illegal transitions return 409.
TRANSITIONS: dict[str, set[str]] = {
    "draft": {"open", "cancelled"},
    "open": {"assigned", "on_hold", "cancelled"},
    "assigned": {"in_progress", "on_hold", "cancelled"},
    "in_progress": {"completed", "on_hold"},
    "on_hold": {"open", "assigned", "in_progress", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def validate_transition(from_state: str, to_state: str) -> None:
    if to_state not in TRANSITIONS.get(from_state, set()):
        raise ConflictError(
            f"cannot transition work order from {from_state!r} to {to_state!r}",
            code="invalid_transition",
        )
