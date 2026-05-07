"""Smoke coverage for /api/v1/comments — was a gap before P2-C.

Covers the cross-tenant fix from P0-1 (delete_comment + update_comment
no longer accept arbitrary IDs) and the standard CRUD lifecycle.
"""

from __future__ import annotations

import pytest
from flask import g

from app.extensions import db
from app.models import Comment, WorkOrder
from tests.conftest import make_tenant, make_user


@pytest.fixture
def wo(app, tenant):
    g.skip_tenant_filter = True
    w = WorkOrder(
        tenant_id=tenant.id,
        wo_number="WO-2026-50000",
        type="reactive",
        category="repair",
        priority="normal",
        status="open",
        title="Test WO for comments",
    )
    db.session.add(w)
    db.session.commit()
    return w


def test_create_comment_then_list(admin_client, wo):
    create = admin_client.post(
        "/api/v1/comments",
        json={"entity_type": "work_order", "entity_id": wo.id, "body": "first comment"},
    )
    assert create.status_code == 201, create.get_json()
    body = create.get_json()
    assert body["body"] == "first comment"
    assert body["entity_type"] == "work_order"

    listing = admin_client.get(f"/api/v1/comments?entity_type=work_order&entity_id={wo.id}")
    assert listing.status_code == 200
    items = listing.get_json()["items"]
    assert len(items) == 1
    assert items[0]["body"] == "first comment"


def test_update_own_comment(admin_client, wo):
    create = admin_client.post(
        "/api/v1/comments",
        json={"entity_type": "work_order", "entity_id": wo.id, "body": "before edit"},
    )
    comment_id = create.get_json()["id"]
    patch = admin_client.patch(f"/api/v1/comments/{comment_id}", json={"body": "after edit"})
    assert patch.status_code == 200, patch.get_json()
    assert patch.get_json()["body"] == "after edit"


def test_soft_delete_returns_204(admin_client, wo):
    create = admin_client.post(
        "/api/v1/comments",
        json={"entity_type": "work_order", "entity_id": wo.id, "body": "to delete"},
    )
    comment_id = create.get_json()["id"]
    delete = admin_client.delete(f"/api/v1/comments/{comment_id}")
    assert delete.status_code == 204


def test_cross_tenant_update_returns_404(app, admin_client, tenant):
    """Direct test of the P0-1 fix — db.session.get had let an admin in
    tenant A edit a comment in tenant B by ID enumeration; the select()
    swap routes through the tenant-filter listener."""
    g.skip_tenant_filter = True
    other = make_tenant(slug="other", name="Other Water")
    other_user = make_user(other, email="admin@other.io", role_codes=["admin"])
    other_wo = WorkOrder(
        tenant_id=other.id,
        wo_number="WO-2026-99999",
        type="reactive",
        category="other",
        priority="normal",
        status="open",
        title="Other tenant WO",
    )
    db.session.add(other_wo)
    db.session.flush()
    other_comment = Comment(
        tenant_id=other.id,
        entity_type="work_order",
        entity_id=other_wo.id,
        body="other tenant comment",
        created_by=other_user.id,
    )
    db.session.add(other_comment)
    db.session.commit()
    other_id = other_comment.id

    # admin_client is logged into tenant "acme"; trying to edit
    # "other" tenant's comment must 404, not 200.
    patch = admin_client.patch(f"/api/v1/comments/{other_id}", json={"body": "hacked"})
    assert patch.status_code == 404, patch.get_json()
    delete = admin_client.delete(f"/api/v1/comments/{other_id}")
    assert delete.status_code == 404, delete.get_json()
