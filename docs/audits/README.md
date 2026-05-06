# Audits

Artifacts from each audit go here. Naming convention: `YYYY-QN-<code>.md` for
quarterly, `YYYY-MM-<code>.md` for monthly, `YYYY-MM-DD-<code>.md` for ad-hoc.

Framework: [`../AUDIT_FRAMEWORK.md`](../AUDIT_FRAMEWORK.md). Templates +
script catalog: [`../AUDIT_TEMPLATES_AND_SCRIPTS.md`](../AUDIT_TEMPLATES_AND_SCRIPTS.md).

## Latest

| Audit | Latest | Result |
|---|---|---|
| EXPR-PAR | [2026-Q2](2026-Q2-expr-par.md) | pass; fixture count gap medium |
| CONTENT | [2026-Q2](2026-Q2-content.md) | pass; 2 medium pending content |
| MT-ISO | [2026-Q2](2026-Q2-mt-iso.md) | pass; 19 medium annotation pass |
| SEC | [2026-Q2](2026-Q2-sec.md) | pass; 2 tooling gaps |
| TEST | [2026-Q2](2026-Q2-test.md) | pass; coverage tooling gap |
| CODE | [2026-Q2](2026-Q2-code.md) | 65 ruff errors (E501 in seeds) |
| DATA | [2026-Q2](2026-Q2-data.md) | pass |
| Monthly Lite | [2026-05](2026-05-monthly-lite.md) | pass — first |

## Living registers

- [`debt.md`](debt.md) — accepted technical debt
- [`friction_map.md`](friction_map.md) — UX friction tracker
- [`flake_log.md`](flake_log.md) — flaky test tracker

## Templates

- [`_template.md`](_template.md) — copy for new audit artifacts
- [`../adr/_template.md`](../adr/_template.md) — for architecture decision records

## Tooling

Scripts live in [`../../tools/audit/`](../../tools/audit/). Runnable today:

- `content_integrity.py` — CONTENT
- `mt_iso_scan.py` — MT-ISO
