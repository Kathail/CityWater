# CityWater Audit — Templates & Scripts

Companion to `AUDIT_FRAMEWORK.md`. The runnable bits.

---

## Artifact template (`docs/audits/_template.md`)

Copy this for every new audit. Fill it in. Commit it.

```markdown
# <Audit Name> — <Period>

**Audit code:** <SEC | MT-ISO | CONTENT | ...>
**Date:** YYYY-MM-DD
**Auditor:** Kyle (with Claude Code draft pass)
**Scope:** <one sentence>
**Commit at audit time:** <git sha>
**Previous audit:** <link to last instance, or "first">

## Summary

One paragraph. What was checked, headline result, any standout findings.

## Findings

| ID  | Severity | Area    | Finding                            | Evidence                  | Tracking |
|-----|----------|---------|------------------------------------|---------------------------|----------|
| F1  | high     | auth    | Session cookie missing SameSite    | app/extensions.py:42      | #N       |
| F2  | medium   | perf    | N+1 on /assets list                | logs/q2-perf-1.txt        | #M       |

## Pass/fail by checkpoint

- [x] CP-XXX-1 — <description>
- [ ] CP-XXX-2 — <description>  ← see F1
- [x] CP-XXX-3 — <description>
- [N/A] CP-XXX-4 — <description, with reason for N/A>

## Script outputs

(Paste relevant output from tools/audit/*.py / *.sh runs.)

## Notes

Free-form. Anything that doesn't fit a checkpoint but should be remembered.

## Sign-off

Reviewed: YYYY-MM-DD
Findings filed as tracking issues: <list>
Release-blocking findings: <none | list>
Next audit due: YYYY-MM-DD
```

---

## Script catalog (`tools/audit/`)

Scripts that produce audit output. All write Markdown that pastes directly
into the artifact's "Script outputs" section.

### `tools/audit/grep_unscoped_queries.py` (for MT-ISO)

```python
#!/usr/bin/env python3
"""Flag suspicious queries that may bypass tenant filtering.

Searches the backend for:
- Raw SQL via db.session.execute(text(...)) without tenant_id parameter
- SQLAlchemy queries on tenant-scoped models without an obvious tenant filter
- Background job entry points that don't accept a tenant_id argument
"""
import re
import sys
from pathlib import Path

TENANT_SCOPED_MODELS = {
    "Asset", "WorkOrder", "ServiceRequest", "Inspection",
    "TaskDefinition", "Program", "ProgramRun", "CannedComment",
    "Season", "WeatherObservation", "AuditLog",
}

backend = Path("backend/app")
findings = []

# 1. Raw SQL
for path in backend.rglob("*.py"):
    src = path.read_text()
    for m in re.finditer(r"session\.execute\(\s*text\((.+?)\)", src, re.DOTALL):
        snippet = m.group(0)
        if "tenant_id" not in snippet:
            findings.append((path, m.start(), "raw SQL without tenant_id", snippet[:200]))

# 2. SQLAlchemy queries on scoped models
for path in backend.rglob("*.py"):
    src = path.read_text()
    for model in TENANT_SCOPED_MODELS:
        # naive but useful — requires manual review of each hit
        for m in re.finditer(rf"select\(\s*{model}\b", src):
            chunk = src[m.start(): m.start() + 400]
            if "tenant_id" not in chunk and "current_tenant" not in chunk:
                findings.append((path, m.start(), f"select({model}) without obvious tenant filter", chunk[:200]))

# 3. RQ jobs
for path in (backend / "jobs").rglob("*.py"):
    src = path.read_text()
    for m in re.finditer(r"def\s+(\w+)\((.*?)\):", src):
        args = m.group(2)
        if "tenant_id" not in args and m.group(1) not in {"__init__"}:
            findings.append((path, m.start(), f"job {m.group(1)} missing tenant_id arg", m.group(0)))

print("# MT-ISO scan output\n")
print(f"Files scanned: {len(list(backend.rglob('*.py')))}")
print(f"Suspicious patterns: {len(findings)}\n")

for path, pos, kind, snippet in findings:
    print(f"### {path}:{pos}")
    print(f"**{kind}**\n")
    print("```python")
    print(snippet)
    print("```\n")

sys.exit(1 if findings else 0)
```

### `tools/audit/content_integrity.py` (for CONTENT)

```python
#!/usr/bin/env python3
"""Check content integrity across task definitions, programs, seasons."""
from app import create_app
from app.extensions import db
from app.models import (
    TaskDefinition, Program, ProgramRun, AssetClass, CannedComment, Season,
)
from app.services.expr import parse, ExpressionParseError
from app.services.programs.scheduler import preview_runs
from sqlalchemy import select

app = create_app()
findings = []

with app.app_context():
    tasks = db.session.scalars(
        select(TaskDefinition).where(TaskDefinition.status == "active")
    ).all()
    task_codes = {t.code for t in tasks}

    classes = db.session.scalars(select(AssetClass)).all()
    class_codes = {c.code for c in classes}

    cc_categories = set(
        db.session.scalars(select(CannedComment.category).distinct()).all()
    )

    # CP-CON-1, CP-CON-2: parse all expressions
    def collect_exprs(td: TaskDefinition):
        for f in td.form:
            if "show_if" in f:
                yield ("show_if", f["id"], f["show_if"])
        for s in td.procedure.get("steps", []):
            if "auto_complete_when" in s:
                yield ("auto_complete_when", f"step {s['n']}", s["auto_complete_when"])
        if td.completion.get("expression"):
            yield ("completion.expression", "-", td.completion["expression"])
        for sp in td.spawns:
            if "when" in sp:
                yield ("spawn.when", sp.get("task","?"), sp["when"])

    for td in tasks:
        for kind, where, expr in collect_exprs(td):
            try:
                parse(expr)
            except ExpressionParseError as e:
                findings.append(("high", "CP-CON-2", f"{td.code}: {kind} at {where} parse error: {e}"))

        # CP-CON-3
        for sp in td.spawns:
            if sp.get("task") and sp["task"] not in task_codes:
                findings.append(("medium", "CP-CON-3", f"{td.code}: spawn target {sp['task']} not active"))

        # CP-CON-4
        for cat in td.canned_comments:
            if cat not in cc_categories:
                findings.append(("medium", "CP-CON-4", f"{td.code}: canned_comment category {cat} missing"))

        # CP-CON-5
        for cls in td.applies_to_classes:
            if cls not in class_codes:
                findings.append(("high", "CP-CON-5", f"{td.code}: applies_to_classes {cls} missing"))

    # CP-CON-6, CP-CON-7
    for prog in db.session.scalars(
        select(Program).where(Program.status == "active")
    ).all():
        if prog.task_definition_code not in task_codes:
            findings.append(("high", "CP-CON-6", f"{prog.code}: task {prog.task_definition_code} not active"))
        try:
            runs = preview_runs(prog, months=12)
            if not runs:
                findings.append(("medium", "CP-CON-7", f"{prog.code}: 12-month preview empty"))
        except Exception as e:
            findings.append(("high", "CP-CON-7", f"{prog.code}: preview failed: {e}"))

    # CP-CON-10, CP-CON-11
    for tenant_id in db.session.scalars(select(Season.tenant_id).distinct()).all():
        seasons = db.session.scalars(
            select(Season).where(Season.tenant_id == tenant_id)
        ).all()
        # zero-width
        for s in seasons:
            if s.start_md == s.end_md:
                findings.append(("medium", "CP-CON-10", f"tenant {tenant_id}: season {s.code} zero-width"))
        # gap check skipped here for brevity — implement with explicit calendar walk

print("# CONTENT audit output\n")
print(f"Findings: {len(findings)}\n")
for sev, cp, msg in findings:
    print(f"- **{sev}** — {cp}: {msg}")
```

### `tools/audit/expr_parity.sh` (for EXPR-PAR)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Run backend evaluator over fixtures, capture results
cd backend
uv run python -m tools.expr_runner ../tests/fixtures/expr_cases.json > /tmp/expr_py.json
cd ..

# Run frontend evaluator over the same fixtures
cd frontend
npx tsx tools/expr-runner.ts ../tests/fixtures/expr_cases.json > /tmp/expr_ts.json
cd ..

# Diff
if diff -u /tmp/expr_py.json /tmp/expr_ts.json > /tmp/expr_diff.txt; then
    echo "# EXPR-PAR: pass"
    echo
    echo "Cases: $(jq length /tmp/expr_py.json)"
    echo "Divergences: 0"
    exit 0
else
    echo "# EXPR-PAR: FAIL"
    echo
    echo "Divergences:"
    cat /tmp/expr_diff.txt
    exit 1
fi
```

### `tools/audit/perf_smoke.py` (for PERF)

```python
#!/usr/bin/env python3
"""Fire canonical query set against a staging snapshot, capture timings."""
import json
import time
from datetime import datetime
from pathlib import Path
import requests

CANONICAL = [
    ("GET", "/api/v1/assets?class=WAT_HYD&page_size=50", 200),
    ("GET", "/api/v1/work-orders?status=open&page_size=50", 200),
    ("GET", "/api/v1/work-orders/WO-2026-00001/resolved", 150),
    ("GET", "/api/v1/programs", 200),
    ("GET", "/api/v1/program-runs?status=in_progress", 200),
    ("GET", "/api/v1/inspections?kind=cctv&page_size=50", 200),
]

base = "https://staging.citywater.app"
session = requests.Session()
session.cookies.set("session", "<staging session>")

results = []
for method, path, target in CANONICAL:
    times = []
    for _ in range(20):
        t0 = time.perf_counter()
        r = session.request(method, base + path)
        r.raise_for_status()
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    p50 = times[10]
    p95 = times[18]
    status = "PASS" if p95 < target else "FAIL"
    results.append((method, path, p50, p95, target, status))

# Compare to baseline
baseline_path = Path("docs/audits/baseline_perf.json")
baseline = json.loads(baseline_path.read_text()) if baseline_path.exists() else {}

print("# PERF smoke output\n")
print(f"| Method | Path | p50 | p95 | Target | Δ vs baseline | Status |")
print(f"|---|---|---|---|---|---|---|")
for m, p, p50, p95, target, status in results:
    base_p95 = baseline.get(p, {}).get("p95")
    delta = f"{(p95 - base_p95):+.0f}ms" if base_p95 else "—"
    print(f"| {m} | `{p}` | {p50:.0f}ms | {p95:.0f}ms | {target}ms | {delta} | {status} |")

# Update baseline
new_baseline = {p: {"p50": p50, "p95": p95} for m, p, p50, p95, t, s in results}
baseline_path.write_text(json.dumps(new_baseline, indent=2))
```

### `tools/audit/data_integrity.py` (for DATA)

```python
#!/usr/bin/env python3
"""Sampled data integrity checks."""
import random
from app import create_app
from app.extensions import db
from app.models import WorkOrder, ProgramRunAsset, AuditLog
from sqlalchemy import select, text

app = create_app()
random.seed(20260506)  # deterministic so progress is visible

findings = []

with app.app_context():
    # CP-DATA-2 audit log sample
    audit_sample = db.session.scalars(
        select(AuditLog).order_by(AuditLog.id.desc()).limit(100)
    ).all()
    for row in audit_sample:
        if row.action == "update" and (row.before is None or row.after is None):
            findings.append(("high", "CP-DATA-2", f"audit_log {row.id}: missing before/after on update"))

    # CP-DATA-4 reconstructibility (lightweight version)
    closed = db.session.scalars(
        select(WorkOrder).where(WorkOrder.status == "completed").limit(5)
    ).all()
    for wo in closed:
        events = db.session.scalars(
            select(AuditLog).where(
                AuditLog.entity_type == "work_order", AuditLog.entity_id == wo.id
            ).order_by(AuditLog.occurred_at)
        ).all()
        if not events:
            findings.append(("critical", "CP-DATA-4", f"WO {wo.wo_number}: no audit log events"))
        elif events[0].action != "create":
            findings.append(("high", "CP-DATA-4", f"WO {wo.wo_number}: first event is {events[0].action}, not create"))

    # CP-DATA-6 orphaned program_run_asset rows
    orphans = db.session.execute(text("""
        SELECT count(*) FROM program_run_asset pra
        LEFT JOIN asset a ON a.id = pra.asset_id
        WHERE a.id IS NULL OR a.deleted_at IS NOT NULL
    """)).scalar()
    if orphans:
        findings.append(("high", "CP-DATA-6", f"orphaned program_run_asset rows: {orphans}"))

print("# DATA audit output\n")
print(f"Findings: {len(findings)}\n")
for sev, cp, msg in findings:
    print(f"- **{sev}** — {cp}: {msg}")
```

### `tools/audit/monthly_lite.sh` (for MON-LITE)

```bash
#!/usr/bin/env bash
set -uo pipefail   # not -e — we want to continue past failures and report them all

ARTIFACT="docs/audits/$(date +%Y-%m)-monthly-lite.md"
mkdir -p docs/audits

cat > "$ARTIFACT" <<EOF
# Monthly Lite — $(date +%Y-%m)

**Date:** $(date +%Y-%m-%d)
**Commit:** $(git rev-parse HEAD)

## Dependency scans

EOF

echo "### pip-audit" >> "$ARTIFACT"
echo '```' >> "$ARTIFACT"
(cd backend && uv run pip-audit) >> "$ARTIFACT" 2>&1 || echo "pip-audit failed" >> "$ARTIFACT"
echo '```' >> "$ARTIFACT"

echo "### npm audit" >> "$ARTIFACT"
echo '```' >> "$ARTIFACT"
(cd frontend && npm audit --omit=dev) >> "$ARTIFACT" 2>&1 || echo "npm audit failed" >> "$ARTIFACT"
echo '```' >> "$ARTIFACT"

echo "## Secret scan" >> "$ARTIFACT"
echo '```' >> "$ARTIFACT"
gitleaks detect --source . --no-banner -v >> "$ARTIFACT" 2>&1 || echo "gitleaks reported findings" >> "$ARTIFACT"
echo '```' >> "$ARTIFACT"

echo "## Content integrity (smoke)" >> "$ARTIFACT"
python tools/audit/content_integrity.py >> "$ARTIFACT" 2>&1 || true

echo "## Expression evaluator parity" >> "$ARTIFACT"
bash tools/audit/expr_parity.sh >> "$ARTIFACT" 2>&1 || true

echo "## Notes" >> "$ARTIFACT"
echo "" >> "$ARTIFACT"
echo "_Add observations, sign off, and next-month focus here._" >> "$ARTIFACT"

echo "Wrote $ARTIFACT"
```

---

## In-app feedback feature (for WORKFLOW)

Add a `task_definition_feedback` table:

```sql
CREATE TABLE task_definition_feedback (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       BIGINT NOT NULL,
  task_definition_id BIGINT NOT NULL REFERENCES task_definition(id),
  task_definition_version INT NOT NULL,
  user_id         BIGINT NOT NULL REFERENCES "user"(id),
  category        TEXT NOT NULL,   -- 'wrong'|'missing'|'unclear'|'too_slow'|'other'
  comment         TEXT NULL,
  context         JSONB NULL,      -- screen, WO id if any
  status          TEXT NOT NULL DEFAULT 'new',  -- 'new'|'triaged'|'addressed'|'wontfix'
  resolution_note TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Add a small "report a problem" button to every rendered task definition.
Submissions are anonymous to other users; admins see them. Drives CP-WF-3.

---

## ADR template (`docs/adr/_template.md`)

```markdown
# ADR-NNNN: <title>

**Date:** YYYY-MM-DD
**Status:** proposed | accepted | superseded by ADR-MMMM

## Context

What problem is this decision addressing? What are the forces at play?

## Decision

What was decided. One paragraph max.

## Consequences

What becomes easier? What becomes harder? What did this lock us out of?

## Alternatives considered

Brief notes on what else was on the table and why it was passed over.
```

---

## Cross-references

The audits in `AUDIT_FRAMEWORK.md` reference contracts in:

- `CLAUDE.md` — conventions and hard rules. When citing a hard rule violation, use the rule's number from CLAUDE.md.
- `docs/SPEC.md` — functional spec, acceptance criteria
- `docs/cc/LINK_AUTOPOPULATION.md`
- `docs/cc/TASK_DEFINITIONS.md`
- `docs/cc/SEASONAL_PROGRAMS.md`

When findings are filed, the tracking issue should reference both the
checkpoint (CP-XXX-N) and the contract section being violated.
