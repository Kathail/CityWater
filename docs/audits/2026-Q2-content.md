# Content Integrity (CONTENT) — 2026 Q2

**Audit code:** CONTENT
**Date:** 2026-05-06
**Auditor:** Claude Code (draft) — pending Kyle review
**Scope:** Static integrity of every active task definition: expression parsing/evaluation, applies_to_classes resolution, spawn target resolution, smart_comment + procedure step structure.
**Commit at audit time:** `b189c7e`
**Previous audit:** first

## Summary

29 active task definitions checked across the demo tenant (1 keystone seed + 28 catalog entries). Every expression parses cleanly and evaluates without error against both empty and populated contexts. Every `applies_to_classes` reference resolves to a registered asset class. Two medium findings — both spawn targets that the keystone seed flagged as "pending content" with graceful fallback. Program/season checkpoints (CP-CON-6 through 11) are skipped — those features are tracked as Pending in the framework. **Pass.**

## Findings

| ID | Severity | Area | Finding | Evidence | Tracking |
|----|----------|------|---------|----------|----------|
| F1 | medium | content | `WAT-TASK-DISCOLOURED` spawn target `WAT-TASK-AREA-FLUSH` not active. Graceful fallback documented in keystone PR. | `app/seeds/tasks/wat_discoloured.py` | open — pending content |
| F2 | medium | content | `WAT-TASK-DISCOLOURED` spawn target `WAT-TASK-FOLLOWUP` not active. Same fallback. | same | open — pending content |

## Pass/fail by checkpoint

- [x] CP-CON-1 — every active `task_definition` validates (Pydantic round-trip via `test_task_catalog.py`).
- [x] CP-CON-2 — every `show_if`, `auto_complete_when`, completion `expression`, spawn `when`, smart_comment `condition` parses + evaluates cleanly.
- [ ] CP-CON-3 — every spawn target resolves. **2 known pending targets (F1, F2).**
- [N/A] CP-CON-4 — `canned_comment.category` check. The system stores categories as `TEXT[]` on tasks, not as a separate table. Checkpoint should be reworded, or a `canned_comment` table added if categories grow.
- [x] CP-CON-5 — every `applies_to_classes[]` resolves to a registered asset class.
- [Pending] CP-CON-6 through CP-CON-11 — programs and seasons not yet built.
- [x] CP-CON-12 — every active `asset_class` has a JSONB-shaped attribute schema (sampled).
- [Skipped] CP-CON-13 — full asset attribute validation. Sample sweep deferred to Q3.

## Script outputs

```
$ uv run python tools/audit/content_integrity.py

# CONTENT audit

Active task definitions checked: 29
Asset classes registered: 23

## Findings

- **medium** — CP-CON-3: WAT-TASK-DISCOLOURED: spawn target 'WAT-TASK-AREA-FLUSH' not active (may be intentional pending content)
- **medium** — CP-CON-3: WAT-TASK-DISCOLOURED: spawn target 'WAT-TASK-FOLLOWUP' not active (may be intentional pending content)

## Summary

Total: 2 (0 high)
```

## Notes

- The `comment_when_checked` blanket coverage (commit `0e7ca3f`) means every procedure step now has a checklist comment template. Catalog: 72/72 steps templated. Keystone discoloured-water: 6/6.
- Smart comment IDs verified unique within each task (29/29 task definitions clean).
- Procedure step numbers verified unique within each task (29/29 clean).

## Sign-off

Reviewed: pending
Findings filed as tracking issues: F1, F2 — pending content batch
Release-blocking findings: none (gating only for active programs; programs not built)
Next audit due: 2026-Q3 + monthly-lite
