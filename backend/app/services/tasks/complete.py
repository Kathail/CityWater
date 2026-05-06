"""Completion contract for a task: required fields + boolean expression.

Both must pass before status transitions to `completed`. Auto-marks set
extra fields when their `when` expressions evaluate true (typically
backfilling implied state, e.g. `customer_notified=true` when
`outcome=='resolved_on_site'`).

Form-level validation lives elsewhere (Pydantic-y per-field rules in
`tasks/validate.py` if and when we need them); this module only answers
"is this entity complete?".
"""

from __future__ import annotations

from typing import Any

from app.models import TaskDefinition
from app.services.expr import safe_evaluate


def is_complete(
    task: TaskDefinition, task_data: dict, entity_ctx: dict | None = None
) -> tuple[bool, list[str]]:
    """Return (passed, list_of_unmet_requirements).

    `entity_ctx` adds non-task-data fields (e.g. `category`, `priority`)
    to the expression evaluation scope. Pass {} or None when only
    task_data matters.
    """
    completion = task.completion or {}
    unmet: list[str] = []

    required = completion.get("required_fields") or []
    for field in required:
        value = task_data.get(field)
        if value in (None, "", [], {}):
            unmet.append(field)

    expression = completion.get("expression")
    ctx: dict[str, Any] = {**(entity_ctx or {}), **task_data}
    # Don't double-list missing required fields — the expression often
    # references the same fields. Surface as a generic gate.
    if expression and not safe_evaluate(expression, ctx, default=False) and not unmet:
        unmet.append("expression")

    return len(unmet) == 0, unmet


def apply_auto_marks(task: TaskDefinition, task_data: dict) -> dict:
    """Return updated task_data with completion `auto_marks` applied.

    Each auto_mark fires when its `when` evaluates true; the `set`
    payload merges into task_data. Doesn't mutate the input.
    """
    completion = task.completion or {}
    marks = completion.get("auto_marks") or []
    if not marks:
        return dict(task_data)

    out = dict(task_data)
    for rule in marks:
        when = rule.get("when")
        if when and not safe_evaluate(when, out, default=False):
            continue
        for k, v in (rule.get("set") or {}).items():
            out.setdefault(k, v)
    return out
