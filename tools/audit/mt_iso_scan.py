#!/usr/bin/env python3
"""MT-ISO audit — multi-tenant isolation static scan.

Smarter than naive grep: knows about the session-level tenant filter listener
in app/services/tenancy.py so that ORM queries on TenantScopedMixin models
DON'T need explicit tenant_id predicates. Flags only the actual escape hatches:

- Raw SQL via session.execute(text(...)) on tenant-scoped tables without
  a tenant_id parameter.
- Queries that explicitly opt out of the filter via skip_tenant_filter
  without a justifying comment in the same file.
- Background job entry points that don't take a tenant_id argument.
- Endpoints accepting tenant_id from request body / query (which would let
  a client supply a different tenant).

Run: cd backend && uv run python ../tools/audit/mt_iso_scan.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend" / "app"

# Tables/keywords that always indicate tenant-scoped data. Matches in raw
# SQL trigger findings unless tenant_id is also present.
SCOPED_TABLES = {
    "asset", "work_order", "service_request", "inspection",
    "task_definition", "comment", "schedule", "audit_log",
    "user_role", "crew", "wo_template", "entity_link",
    "work_order_task", "work_order_time_log", "work_order_material",
    "work_order_attachment",
}


def main() -> int:
    findings: list[tuple[str, str, str, str]] = []  # severity, cp, where, msg

    # 1. Raw SQL executed via text(...) — flag if it touches a scoped table
    # and lacks a tenant_id parameter.
    raw_sql_pattern = re.compile(
        r"session\.execute\s*\(\s*text\(\s*['\"]([^'\"]+)['\"]\s*\)([^)]*?)\)",
        re.DOTALL,
    )
    for path in BACKEND.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        try:
            src = path.read_text()
        except UnicodeDecodeError:
            continue
        for m in raw_sql_pattern.finditer(src):
            sql = m.group(1).lower()
            args = m.group(2)
            mentions_scoped = any(t in sql for t in SCOPED_TABLES)
            if mentions_scoped and "tenant_id" not in (sql + args):
                line_no = src[: m.start()].count("\n") + 1
                findings.append((
                    "high", "CP-MT-3",
                    f"{path.relative_to(REPO)}:{line_no}",
                    f"raw SQL on scoped table without tenant_id: {sql[:80]!r}",
                ))

    # 2. Explicit skip_tenant_filter usage — should be rare and justified.
    skip_pattern = re.compile(r"skip_tenant_filter\s*=\s*True")
    for path in BACKEND.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        try:
            src = path.read_text()
        except UnicodeDecodeError:
            continue
        for m in skip_pattern.finditer(src):
            line_no = src[: m.start()].count("\n") + 1
            # Look at the 3 lines above for a justifying comment.
            window_start = max(0, m.start() - 400)
            preceding = src[window_start : m.start()]
            has_comment = any(
                ln.strip().startswith("#") for ln in preceding.split("\n")[-3:]
            )
            sev = "low" if has_comment else "medium"
            findings.append((
                sev, "CP-MT-3",
                f"{path.relative_to(REPO)}:{line_no}",
                f"skip_tenant_filter=True {'(commented)' if has_comment else 'without justifying comment'}",
            ))

    # 3. Endpoints reading tenant_id from request body/query.
    suspect_pattern = re.compile(
        r"request\.(?:args|json|form|values)(?:\.get)?[\(\[]\s*['\"]tenant_id['\"]"
    )
    for path in (BACKEND / "api").rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        try:
            src = path.read_text()
        except UnicodeDecodeError:
            continue
        for m in suspect_pattern.finditer(src):
            line_no = src[: m.start()].count("\n") + 1
            findings.append((
                "critical", "CP-MT-3",
                f"{path.relative_to(REPO)}:{line_no}",
                "endpoint reads tenant_id from client request — must derive from session",
            ))

    # 4. RQ jobs (if any) — every job entry point should take tenant_id.
    jobs_dir = BACKEND / "jobs"
    if jobs_dir.exists():
        for path in jobs_dir.rglob("*.py"):
            if "__pycache__" in path.parts or path.name == "__init__.py":
                continue
            try:
                src = path.read_text()
            except UnicodeDecodeError:
                continue
            for m in re.finditer(r"^def\s+(\w+)\(([^)]*)\):", src, re.MULTILINE):
                name, args = m.group(1), m.group(2)
                if name.startswith("_"):
                    continue
                if "tenant_id" not in args:
                    line_no = src[: m.start()].count("\n") + 1
                    findings.append((
                        "high", "CP-MT-5",
                        f"{path.relative_to(REPO)}:{line_no}",
                        f"job {name!r} doesn't accept tenant_id arg",
                    ))

    # 5. Tenancy listener present?
    tenancy_path = BACKEND / "services" / "tenancy.py"
    if not tenancy_path.exists():
        findings.append((
            "critical", "CP-MT-2",
            str(tenancy_path.relative_to(REPO)),
            "tenancy.py session listener missing",
        ))
    elif "do_orm_execute" not in tenancy_path.read_text():
        findings.append((
            "critical", "CP-MT-2",
            str(tenancy_path.relative_to(REPO)),
            "tenancy.py exists but doesn't register a do_orm_execute listener",
        ))

    # Report
    print("# MT-ISO scan output\n")
    print(f"Files scanned: {sum(1 for _ in BACKEND.rglob('*.py'))}\n")

    if not findings:
        print("## Findings\n\n- _none_\n")
        return 0

    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for sev, *_ in findings:
        counts[sev] = counts.get(sev, 0) + 1

    print("## Findings\n")
    for sev in ("critical", "high", "medium", "low"):
        for s, cp, where, msg in findings:
            if s == sev:
                print(f"- **{s}** — {cp} — `{where}`")
                print(f"  - {msg}")

    print("\n## Summary\n")
    print(f"- critical: {counts['critical']}")
    print(f"- high:     {counts['high']}")
    print(f"- medium:   {counts['medium']}")
    print(f"- low:      {counts['low']}")

    return 1 if counts["critical"] or counts["high"] else 0


if __name__ == "__main__":
    sys.exit(main())
