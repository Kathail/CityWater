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

## Pass/fail by checkpoint

- [x] CP-XXX-1 — <description>
- [ ] CP-XXX-2 — <description>  ← see F1
- [N/A] CP-XXX-3 — <description, with reason for N/A>

## Script outputs

(Paste relevant output from tools/audit/*.py / *.sh runs.)

## Notes

Free-form. Anything that doesn't fit a checkpoint but should be remembered.

## Sign-off

Reviewed: YYYY-MM-DD
Findings filed as tracking issues: <list>
Release-blocking findings: <none | list>
Next audit due: YYYY-MM-DD
