# Accepted Technical Debt

Living register of known debt. Updated quarterly during the CODE audit.
Each entry: what it is, why it's debt, severity, paying-it-down plan, age.

| ID | Item | Why debt | Severity | Plan | First logged | Last reviewed |
|----|------|----------|----------|------|--------------|---------------|
| D1 | E501 line-length violations in `simulate_year.py` and `seeds/tasks/catalog.py` | 63 long-string violations in seed/CLI files where readability of the natural-text strings outweighs column count | medium | Add `pyproject.toml` per-file-ignore for these files OR reflow. Address in next CODE cleanup pass. | 2026-05-06 (CODE Q2) | 2026-05-06 |
| D2 | `gitleaks` not installed in dev env; CP-SEC-9 deferred | Secret history scanning relies on a tool that isn't available locally | medium | Install via package manager or vendored binary | 2026-05-06 (SEC Q2) | 2026-05-06 |
| D3 | `bandit` not run for CP-SEC-15 | Same gap as D2 | medium | `uv tool install bandit`, add to monthly_lite | 2026-05-06 (SEC Q2) | 2026-05-06 |
| D4 | Coverage tooling (`pytest-cov`) not configured | CP-TEST-1 / CP-TEST-2 thresholds can't be measured | low | Add to dev deps + `pyproject.toml` | 2026-05-06 (TEST Q2) | 2026-05-06 |
| D5 | 19 `skip_tenant_filter=True` bypasses lacking justifying comments | CP-MT-3 spirit: bypasses should be annotated with reason | medium | One-line `# justified: ...` comment above each. Re-run scan after. | 2026-05-06 (MT-ISO Q2) | 2026-05-06 |
| D6 | `expr_cases.json` has 48 fixtures, below CP-EXPR-1 floor of 60 | Parity coverage gap | medium | Author 12+ more cases, especially around season/weather context paths | 2026-05-06 (EXPR-PAR Q2) | 2026-05-06 |
| D7 | `WAT-TASK-AREA-FLUSH` and `WAT-TASK-FOLLOWUP` spawn targets not seeded | Keystone seeds reference these as pending content | medium | Add to catalog when next content batch lands | 2026-05-06 (CONTENT Q2) | 2026-05-06 |
