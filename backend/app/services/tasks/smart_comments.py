"""Smart comment suggestions.

Render the `smart_comments` block of a task definition against the
operator's current `task_data`, returning a list of suggestions whose
condition evaluates true and whose `{var}` placeholders have been
substituted with task_data values.

Contract:
- Suggestive only. The caller decides whether to insert the text into a
  comment composer; this service never persists or mutates anything.
- Conditions use the same evaluator as `show_if` / `auto_complete_when`.
  A broken or unparseable condition fails closed (suggestion is hidden),
  matching the rest of the form's behaviour.
- Variables that are missing from task_data render as `?` so the operator
  notices and can fill in the gap rather than reading "ran cold tap for
  None minutes".
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.services.expr import safe_evaluate

logger = logging.getLogger(__name__)

_VAR_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_.]*)\}")


def _resolve_path(path: str, data: dict[str, Any]) -> Any:
    cursor: Any = data
    for part in path.split("."):
        if not isinstance(cursor, dict) or part not in cursor:
            return None
        cursor = cursor[part]
    return cursor


def _format_value(value: Any) -> str:
    if value is None:
        return "?"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        # Trim trailing zero on whole numbers (12.0 -> 12) but keep
        # meaningful decimals (0.05 -> 0.05).
        if value.is_integer():
            return str(int(value))
        return f"{value:g}"
    return str(value)


def _interpolate(template: str, task_data: dict[str, Any]) -> str:
    def repl(m: re.Match[str]) -> str:
        return _format_value(_resolve_path(m.group(1), task_data))

    return _VAR_RE.sub(repl, template)


def render_suggestions(
    smart_comments: list[dict[str, Any]] | None,
    task_data: dict[str, Any],
) -> list[dict[str, str]]:
    """Filter by condition + interpolate variables.

    Returns `[{"id": ..., "text": ...}, ...]` in the order the comments
    are declared on the task definition. Empty input yields an empty
    list.
    """
    if not smart_comments:
        return []

    out: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for entry in smart_comments:
        sid = entry.get("id")
        text = entry.get("text")
        if not isinstance(sid, str) or not isinstance(text, str):
            logger.warning("smart_comment skipped — missing id/text: %r", entry)
            continue
        if sid in seen_ids:
            logger.warning("smart_comment skipped — duplicate id %r", sid)
            continue
        condition = entry.get("condition")
        # Empty/missing condition is treated as "always show" — same rule
        # the form renderer uses for show_if.
        if condition and not safe_evaluate(condition, task_data, default=False):
            continue
        out.append({"id": sid, "text": _interpolate(text, task_data)})
        seen_ids.add(sid)
    return out
