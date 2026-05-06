from __future__ import annotations

import pytest
from flask import g

from app.extensions import db
from app.models import TaskDefinition
from app.schemas.task_definition import TaskDefinitionRead
from app.seeds.tasks.catalog import TASKS, seed_tasks
from app.seeds.tasks.wat_discoloured import TASK_WAT_DISCOLOURED
from app.services.tasks.smart_comments import render_suggestions


def test_every_task_has_unique_code() -> None:
    codes = [t["code"] for t in TASKS]
    assert len(codes) == len(set(codes)), "Duplicate task codes in catalog"


def test_discoloured_excluded_from_catalog() -> None:
    """The rich keystone task lives in wat_discoloured.py and must not be
    duplicated (and risk being overwritten with a leaner copy) by the
    consolidated catalog."""
    assert "WAT-TASK-DISCOLOURED" not in {t["code"] for t in TASKS}


@pytest.mark.parametrize("spec", TASKS, ids=lambda s: s["code"])
def test_each_task_passes_pydantic_read_shape(spec) -> None:
    """Round-trip every catalog entry through the Pydantic Read schema
    (with mandatory metadata filled in) so future schema drift on the
    column set fails loudly here rather than at seed time."""
    payload = {
        "id": 1,
        "version": spec.get("version", 1),
        "status": "active",
        "lang": "en",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        **spec,
    }
    TaskDefinitionRead.model_validate(payload)


def test_seed_tasks_is_idempotent(app, tenant) -> None:
    with app.app_context():
        g.skip_tenant_filter = True
        # Pre-seed discoloured so the idempotency check has something
        # to skip; matches what seed_demo does in real life.
        db.session.add(TaskDefinition(tenant_id=tenant.id, **TASK_WAT_DISCOLOURED))
        db.session.flush()

        created_first, skipped_first = seed_tasks(db.session, tenant.id)
        db.session.commit()
        assert created_first == len(TASKS)
        assert skipped_first == 0

        # Re-running the seeder must skip everything; nothing new added.
        created_second, skipped_second = seed_tasks(db.session, tenant.id)
        assert created_second == 0
        assert skipped_second == len(TASKS)


def test_seed_tasks_doesnt_clobber_existing_discoloured(app, tenant) -> None:
    """Even if WAT-TASK-DISCOLOURED were ever added to TASKS by mistake,
    the existing rich version (with form / prefill / canned_comments)
    must survive a re-seed unscathed."""
    with app.app_context():
        g.skip_tenant_filter = True
        db.session.add(TaskDefinition(tenant_id=tenant.id, **TASK_WAT_DISCOLOURED))
        db.session.commit()

        seed_tasks(db.session, tenant.id)
        db.session.commit()

        td = (
            db.session.query(TaskDefinition)
            .filter_by(tenant_id=tenant.id, code="WAT-TASK-DISCOLOURED")
            .one()
        )
        # Rich attributes from the original keystone seed are preserved.
        assert td.form, "form was clobbered by re-seed"
        assert td.prefill, "prefill was clobbered by re-seed"
        assert td.canned_comments == ["water_discoloured", "cross_domain"]
        assert len(td.smart_comments) == 7


def test_smart_comments_render_for_every_catalog_task() -> None:
    """Sanity-check that every smart_comments block evaluates without
    raising. Empty task_data should yield an empty (or condition-free)
    suggestion list, not an exception."""
    for spec in TASKS:
        suggestions = render_suggestions(spec.get("smart_comments", []), {})
        # Always-on chips (no condition) come back; conditional chips
        # don't. Either way, the call must succeed and return a list.
        assert isinstance(suggestions, list)
