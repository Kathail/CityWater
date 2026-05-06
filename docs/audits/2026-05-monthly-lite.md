# Monthly Lite — 2026-05

**Date:** 2026-05-06
**Commit:** `b189c7e`
**Auditor:** Claude Code (draft) — pending Kyle review

## Summary

First-ever audit pass on the codebase. Concurrent with the Q2 deep audits, ran the monthly-lite checks across dependency advisories, secret history, content integrity smoke, and expression evaluator parity. **No critical or high findings.** A handful of medium/low items captured in the linked Q2 artifacts.

## Dependency scans

```
$ uv tool run pip-audit
No known vulnerabilities found

$ npm audit --omit=dev
2 moderate severity vulnerabilities
  esbuild <=0.24.2 (dev-server CVE GHSA-67mh-4wv8-2f99) — affects dev server only
  vite (depends on vulnerable esbuild) — same chain
Production bundle is built ahead of time; no exposure to the dev-server vector.
```

## Secret scan

```
$ which gitleaks
(not installed in dev env — checkpoint deferred)
```

Tooling gap. Tracked as F2 in `2026-Q2-sec.md`. Action: `uv tool install` a gitleaks alternative or pull in the official binary, then re-run.

## Content integrity (smoke)

```
$ uv run python tools/audit/content_integrity.py

Active task definitions checked: 29
Asset classes registered: 23

Findings:
  - medium — CP-CON-3: WAT-TASK-DISCOLOURED spawn target 'WAT-TASK-AREA-FLUSH' not active
  - medium — CP-CON-3: WAT-TASK-DISCOLOURED spawn target 'WAT-TASK-FOLLOWUP' not active

Total: 2 (0 high)
```

Both are pending content the keystone PR explicitly flagged. Graceful fallback in place.

## Expression evaluator parity

```
$ jq length backend/tests/fixtures/expr_cases.json
48
$ diff backend/tests/fixtures/expr_cases.json frontend/src/lib/expr.fixtures.json
(no diff — fixtures identical)

$ uv run pytest tests/test_expr.py
50 passed in 0.05s
$ npx vitest run src/lib/expr.test.ts
55 passed
```

Both runners agree on every fixture. No `eval`, `Function()`, or `vm.runInContext` anywhere.

## Error rate snapshot

Sentry / error-monitoring not yet wired. Deferred until the next monthly-lite after observability is set up.

## Cross-references

Concurrent Q2 deep audits filed in:
- `docs/audits/2026-Q2-expr-par.md` — EXPR-PAR
- `docs/audits/2026-Q2-content.md` — CONTENT
- `docs/audits/2026-Q2-mt-iso.md` — MT-ISO
- `docs/audits/2026-Q2-sec.md` — SEC
- `docs/audits/2026-Q2-test.md` — TEST
- `docs/audits/2026-Q2-code.md` — CODE
- `docs/audits/2026-Q2-data.md` — DATA

## Sign-off

Release-blocking findings: none
Outstanding tooling installations recommended before next monthly-lite:
- `gitleaks` (or equivalent for secret history scanning)
- `bandit` (Python static security)
- `pytest-cov` (coverage measurement for CP-TEST-1/-2)

Next monthly-lite due: 2026-06
