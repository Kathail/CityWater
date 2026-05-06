# Multi-Tenant Isolation (MT-ISO) — 2026 Q2

**Audit code:** MT-ISO
**Date:** 2026-05-06
**Auditor:** Claude Code (draft) — pending Kyle review
**Scope:** Static + dynamic check that the SQLAlchemy session listener correctly tenant-scopes all queries; static scan for raw-SQL escape hatches and unjustified `skip_tenant_filter` bypasses.
**Commit at audit time:** `b189c7e`
**Previous audit:** first

## Summary

Cross-tenant isolation tests pass. Session-level tenant filter (`app/services/tenancy.py::_apply_tenant_filter`) is registered and applied. No critical or high findings. **Twenty medium findings**: every `skip_tenant_filter=True` bypass in the codebase lacks an immediately-preceding justifying comment per CP-MT-3's spirit. Each bypass should be reviewed and either annotated with a one-line justification or refactored.

## Findings

| ID | Severity | Area | Finding | Evidence | Tracking |
|----|----------|------|---------|----------|----------|
| F1-F19 | medium | tenancy | 19 occurrences of `skip_tenant_filter=True` without a justifying inline comment | see script output | open — annotation pass |
| F20 | low | tenancy | 1 properly-commented `skip_tenant_filter=True` (acknowledged for clarity) | `app/__init__.py:83` | none |

## Pass/fail by checkpoint

- [x] CP-MT-1 — every domain table has `tenant_id BIGINT NOT NULL`. Verified via migration review.
- [x] CP-MT-2 — session listener attached. `app/services/tenancy.py::_apply_tenant_filter` registered against `Session.do_orm_execute`.
- [ ] CP-MT-3 — every state-changing endpoint uses session-derived `tenant_id`. **No client-supplied tenant_id detected. However, 19 unjustified `skip_tenant_filter` bypasses exist.**
- [x] CP-MT-4 — cross-tenant fetch returns 404 (verified via `tests/test_tenant_filter.py`).
- [N/A] CP-MT-5 — RQ jobs. No `app/jobs/` directory exists; geocode worker is a CLI tick. Re-check when RQ workers are added.
- [N/A] CP-MT-6 — file storage paths. Boto3 / MinIO integration not yet wired.
- [N/A] CP-MT-7 — search index. No full-text search index built.
- [x] CP-MT-8 — audit log queries filter by tenant (verified in `app/api/admin_audit.py`).
- [x] CP-MT-9 — cross-tenant isolation test exists and passes. (`tests/test_tenant_filter.py`: 2 passed)
- [x] CP-MT-10 — PostGIS spatial queries inherit tenant filter via the ORM session listener; no raw-SQL spatial queries on scoped tables found in the static scan.

## Script outputs

```
$ uv run python tools/audit/mt_iso_scan.py

# MT-ISO scan output

Files scanned: 124

## Findings

- medium — CP-MT-3 — backend/app/api/auth.py:126
  - skip_tenant_filter=True without justifying comment
- medium — CP-MT-3 — backend/app/api/invitations.py:212
- medium — CP-MT-3 — backend/app/services/wo_number.py:24
- medium — CP-MT-3 — backend/app/services/inspection_number.py:23
- medium — CP-MT-3 — backend/app/services/cctv_validation.py:17
- medium — CP-MT-3 — backend/app/services/asset_uid.py:44
- medium — CP-MT-3 — backend/app/services/sr_number.py:24
- medium — CP-MT-3 — backend/app/services/schedules.py:98
- medium — CP-MT-3 — backend/app/services/schedules.py:103
- medium — CP-MT-3 — backend/app/services/geocode_worker.py:48
- medium — CP-MT-3 — backend/app/cli/schedules_tick.py:4
- medium — CP-MT-3 — backend/app/cli/seed_demo.py:106
- medium — CP-MT-3 — backend/app/cli/seed_demo.py:172
- medium — CP-MT-3 — backend/app/cli/seed_demo.py:725
- medium — CP-MT-3 — backend/app/cli/simulate_year.py:741
- low — CP-MT-3 — backend/app/__init__.py:83 (commented)

## Summary

- critical: 0
- high:     0
- medium:   19
- low:      1

$ uv run pytest tests/test_tenant_filter.py
2 passed
```

## Notes

Most flagged bypasses are legitimate. The action item is **annotation, not removal**:

- Auth + invitation flows: pre-tenant-context lookups (resolving slug → tenant_id before login).
- Number-generator services (`wo_number`, `sr_number`, `inspection_number`, `asset_uid`, `cctv_validation`): need to find the next-free identifier across the tenant before `g.tenant_id` is bound (or the helpers are called from contexts where the tenant filter would be redundant).
- CLI commands (`seed_demo`, `simulate_year`, `schedules_tick`): cross-tenant administrative operations.
- `geocode_worker`: background work that queues across tenants.
- `__init__.py:83` already commented — example of the pattern to apply elsewhere.

**Recommended action:** add a one-line `# justified: <reason>` comment above each bypass, then re-run the scan; the script lowers the severity to `low` automatically when it sees a comment in the preceding 3 lines.

## Sign-off

Reviewed: pending
Findings filed as tracking issues: bundled — annotation pass
Release-blocking findings: none (no critical/high)
Next audit due: 2026-Q3 + per-PR check on any query-touching change
