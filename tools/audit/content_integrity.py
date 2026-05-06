#!/usr/bin/env python3
"""CONTENT audit — task definition integrity for the current codebase.

Runs:
    cd backend && uv run python ../tools/audit/content_integrity.py

Skips program / season checkpoints (CP-CON-6 through 11) — those features
aren't built yet and are tracked as Pending in AUDIT_FRAMEWORK.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

# When invoked from repo root via `cd backend && uv run python ../tools/audit/...`
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from flask import g  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import AssetClass, TaskDefinition  # noqa: E402
from app.services.expr import ExpressionParseError, parse, safe_evaluate  # noqa: E402

EMPTY_CTX: dict = {}
SAMPLE_CTX: dict = {
    "site_visited": True,
    "cold_run_minutes": 12,
    "cold_outcome": "cleared",
    "chlorine_residual": 0.18,
    "outcome": "resolved_on_site",
    "asset": {"class_code": "WAT_HYD"},
    "season": {"code": "summer"},
}


def main() -> int:
    app = create_app()
    findings: list[tuple[str, str, str]] = []

    with app.app_context():
        g.skip_tenant_filter = True
        tasks = db.session.scalars(
            select(TaskDefinition).where(TaskDefinition.status == "active")
        ).all()
        task_codes = {t.code for t in tasks}
        class_codes = {c.code for c in db.session.scalars(select(AssetClass)).all()}

        print(f"# CONTENT audit\n")
        print(f"Active task definitions checked: {len(tasks)}")
        print(f"Asset classes registered: {len(class_codes)}\n")

        # CP-CON-1, CP-CON-2 — every expression parses + evaluates
        for td in tasks:
            for expr_kind, where, expr in _collect_expressions(td):
                try:
                    parse(expr)
                except ExpressionParseError as e:
                    findings.append((
                        "high",
                        "CP-CON-2",
                        f"{td.code}: parse error in {expr_kind} {where}: {e}",
                    ))
                    continue
                # Eval against empty + populated contexts; safe_evaluate
                # handles missing keys without raising.
                try:
                    safe_evaluate(expr, EMPTY_CTX, default=False)
                    safe_evaluate(expr, SAMPLE_CTX, default=False)
                except Exception as e:  # noqa: BLE001
                    findings.append((
                        "high",
                        "CP-CON-2",
                        f"{td.code}: eval error in {expr_kind} {where}: {e}",
                    ))

            # CP-CON-3 — spawn targets exist
            for sp in td.spawns or []:
                target = sp.get("task")
                if target and target not in task_codes:
                    findings.append((
                        "medium",
                        "CP-CON-3",
                        f"{td.code}: spawn target {target!r} not active "
                        "(may be intentional pending content)",
                    ))

            # CP-CON-5 — applies_to_classes resolve
            for cls in td.applies_to_classes or []:
                if cls not in class_codes:
                    findings.append((
                        "high",
                        "CP-CON-5",
                        f"{td.code}: applies_to_classes {cls!r} not registered",
                    ))

            # Bonus — every smart_comment has a unique id
            ids: set[str] = set()
            for c in (td.smart_comments or []):
                cid = c.get("id")
                if not cid:
                    findings.append((
                        "medium", "CP-CON-extra",
                        f"{td.code}: smart_comment missing id",
                    ))
                elif cid in ids:
                    findings.append((
                        "medium", "CP-CON-extra",
                        f"{td.code}: duplicate smart_comment id {cid!r}",
                    ))
                ids.add(cid)

            # Bonus — every procedure step number unique within task
            step_nums: list[int] = []
            for s in (td.procedure or {}).get("steps", []) or []:
                step_nums.append(s.get("n"))
            if len(step_nums) != len(set(step_nums)):
                findings.append((
                    "medium", "CP-CON-extra",
                    f"{td.code}: duplicate procedure step numbers",
                ))

    print("## Findings\n")
    if not findings:
        print("- _none_\n")
    else:
        for sev, cp, msg in findings:
            print(f"- **{sev}** — {cp}: {msg}")

    high = sum(1 for f in findings if f[0] == "high")
    print(f"\n## Summary\n\nTotal: {len(findings)} ({high} high)")

    # Non-zero only on high.
    return 1 if high else 0


def _collect_expressions(td: TaskDefinition):
    for f in td.form or []:
        if isinstance(f, dict) and f.get("show_if"):
            yield ("show_if", f.get("id", "?"), f["show_if"])
    for s in (td.procedure or {}).get("steps", []) or []:
        if isinstance(s, dict) and s.get("auto_complete_when"):
            yield ("auto_complete_when", f"step {s.get('n', '?')}", s["auto_complete_when"])
    if td.completion and td.completion.get("expression"):
        yield ("completion.expression", "-", td.completion["expression"])
    for sp in td.spawns or []:
        if isinstance(sp, dict) and sp.get("when"):
            yield ("spawn.when", sp.get("task", "?"), sp["when"])
    for c in (td.smart_comments or []):
        if isinstance(c, dict) and c.get("condition"):
            yield ("smart_comment.condition", c.get("id", "?"), c["condition"])


if __name__ == "__main__":
    sys.exit(main())
