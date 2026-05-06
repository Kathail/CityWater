# Expression Evaluator Parity (EXPR-PAR) — 2026 Q2

**Audit code:** EXPR-PAR
**Date:** 2026-05-06
**Auditor:** Claude Code (draft) — pending Kyle review
**Scope:** Verify the Python and TypeScript expression evaluators agree on every shared fixture; confirm no `eval`-class fallback exists.
**Commit at audit time:** `b189c7e`
**Previous audit:** first

## Summary

Both evaluators pass the full shared fixture set with zero divergences. Hand-written recursive-descent parser confirmed in both implementations; no `eval`, `Function()`, `vm.runInContext`, or `literal_eval` anywhere. **Pass.** One advisory: fixture count is 48, below the framework's CP-EXPR-1 floor of 60 — closing this gap is medium effort.

## Findings

| ID | Severity | Area | Finding | Evidence | Tracking |
|----|----------|------|---------|----------|----------|
| F1 | medium | tooling | Fixture count 48 < CP-EXPR-1 floor of 60 | `backend/tests/fixtures/expr_cases.json` | open |
| F2 | medium | tooling | No nightly CI parity job (CP-EXPR-4) — parity is enforced by local test runs only | n/a | open |

## Pass/fail by checkpoint

- [ ] CP-EXPR-1 — fixture count ≥ 60. **Currently 48.**
- [x] CP-EXPR-2 — backend test suite passes the fixture set with zero deviations. (`tests/test_expr.py`: 50/50)
- [x] CP-EXPR-3 — frontend Vitest passes the fixture set with zero deviations. (55/55)
- [ ] CP-EXPR-4 — nightly CI parity job. **Doesn't exist; covered by per-commit test runs only.**
- [N/A] CP-EXPR-5 — no evaluator-touching PR this cycle to validate the per-PR rule against.
- [x] CP-EXPR-6 — no `eval`, `Function()`, `vm.runInContext`. Grep clean (only doc-comment mentions).

## Script outputs

```
$ jq length backend/tests/fixtures/expr_cases.json
48
$ jq length frontend/src/lib/expr.fixtures.json
48
$ diff backend/tests/fixtures/expr_cases.json frontend/src/lib/expr.fixtures.json
(no output — files identical)

$ uv run pytest tests/test_expr.py
50 passed in 0.05s
$ npx vitest run src/lib/expr.test.ts
Tests  55 passed (55)

$ grep -rn '\beval\b\|literal_eval\|Function(\|vm\.runInContext' backend/app frontend/src
backend/app/services/expr.py:5: parser + interpreter — no `eval`, no `literal_eval`, no Python parsing
frontend/src/lib/expr.ts:7:   * parser + interpreter; never falls back to `eval` or `Function()`.
(only doc-comment references)
```

## Notes

- The frontend has 7 vitest tests beyond the 48 shared fixtures (covering `safeEvaluate` defaults and the new `interpolate` helper). Backend has 2 beyond the fixtures.
- Fixture-count gap is the only material finding. Closing it: extend `expr_cases.json` to cover at least 12 more cases, especially around season/weather context paths once those features land.

## Sign-off

Reviewed: pending
Findings filed as tracking issues: F1, F2 — track as backlog
Release-blocking findings: none
Next audit due: 2026-Q3 + on next evaluator-touching PR
