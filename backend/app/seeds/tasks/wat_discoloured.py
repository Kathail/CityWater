"""Seed task definition: WAT-TASK-DISCOLOURED.

The end-to-end proof for the task definitions slice. Created in `active`
status so the integration test can match it without an explicit
activation step.
"""

from __future__ import annotations

from typing import Any

TASK_WAT_DISCOLOURED: dict[str, Any] = {
    "code": "WAT-TASK-DISCOLOURED",
    "version": 1,
    "status": "active",
    "title": "Discoloured water response",
    "summary": "Investigate, flush, verify residual, notify customer.",
    "produces": "work_order",
    "default_category": "investigation",
    "default_priority": "normal",
    "default_domain": "water",
    "applies_to_classes": ["WAT_HYD", "WAT_MAIN", "WAT_SVC"],
    "triggers": [
        {"from": "service_request", "category": "discoloured_water"},
        {"from": "service_request", "category": "water_quality"},
        {"from": "manual", "domain": "water"},
    ],
    "prefill": {
        "from_service_request": [
            "caller_name",
            "caller_phone",
            "reported_address",
            "asset_id",
            "location",
            "description",
        ],
        "from_asset": ["coords", "address_cached"],
    },
    "form": [
        {
            "id": "site_visited",
            "type": "boolean",
            "label": "Site visited",
            "default": False,
            "required_for_complete": True,
        },
        {
            "id": "cold_run_minutes",
            "type": "number",
            "label": "Cold tap run",
            "unit": "min",
            "min": 0,
            "max": 60,
        },
        {
            "id": "cold_outcome",
            "type": "choice",
            "label": "Result",
            "choices": [
                {"value": "cleared", "label": "Cleared"},
                {"value": "still_discoloured", "label": "Still discoloured"},
                {"value": "not_run", "label": "Not run"},
            ],
            "show_if": "cold_run_minutes > 0",
        },
        {
            "id": "hydrant_flushed",
            "type": "asset_pick",
            "label": "Hydrant flushed",
            "asset_class": "WAT_HYD",
            "near_meters": 200,
            "default_from": "nearest_hydrant_to_asset",
        },
        {
            "id": "flush_minutes",
            "type": "number",
            "label": "Flush duration",
            "unit": "min",
            "show_if": "hydrant_flushed != null",
        },
        {
            "id": "chlorine_residual",
            "type": "number",
            "label": "Cl2 residual",
            "unit": "ppm",
            "step": 0.05,
        },
        {
            "id": "likely_cause",
            "type": "choice",
            "label": "Likely cause",
            "choices": [
                {"value": "recent_main_work", "label": "Recent main work"},
                {"value": "hydrant_use", "label": "Hydrant use"},
                {"value": "fire_flow", "label": "Fire flow"},
                {"value": "internal_plumbing", "label": "Internal plumbing"},
                {"value": "unknown", "label": "Unknown"},
            ],
        },
        {
            "id": "outcome",
            "type": "choice",
            "label": "Outcome",
            "choices": [
                {"value": "resolved_on_site", "label": "Resolved on site"},
                {"value": "follow_up_needed", "label": "Follow-up needed"},
                {
                    "value": "referred_internal_plumbing",
                    "label": "Referred (internal plumbing)",
                },
            ],
            "required_for_complete": True,
        },
    ],
    "canned_comments": ["water_discoloured", "cross_domain"],
    "procedure": {
        "preconditions": ["Confirm address and customer contact"],
        "ppe": ["safety vest"],
        "tools_materials": [{"item": "AWWA spanner wrench", "qty": 1}],
        "steps": [
            {
                "n": 1,
                "title": "Contact customer at site",
                "auto_complete_when": "site_visited == true",
            },
            {
                "n": 2,
                "title": "Run cold tap until clear or 10 min",
                "auto_complete_when": "cold_run_minutes >= 10 || cold_outcome == 'cleared'",
            },
            {
                "n": 3,
                "title": "Locate nearest hydrant",
                "auto_complete_when": "hydrant_flushed != null",
            },
            {
                "n": 4,
                "title": "Flush hydrant until clear",
                "auto_complete_when": "flush_minutes > 0",
            },
            {
                "n": 5,
                "title": "Verify Cl2 residual >= 0.05 ppm",
                "auto_complete_when": "chlorine_residual >= 0.05",
            },
            {
                "n": 6,
                "title": "Determine outcome and notify customer",
                "auto_complete_when": "outcome != null",
            },
        ],
        "regulatory": [
            {"jurisdiction": "ON", "ref": "O. Reg 170/03 s.16-3"},
        ],
    },
    "completion": {
        "required_fields": ["site_visited", "outcome"],
        "expression": "site_visited == true && outcome != null",
        "auto_marks": [
            {
                "when": "outcome == 'resolved_on_site'",
                "set": {"customer_notified": True},
            },
        ],
    },
    "spawns": [
        {
            "when": ("likely_cause == 'recent_main_work' && cold_outcome == 'still_discoloured'"),
            "task": "WAT-TASK-AREA-FLUSH",
            "priority": "high",
        },
        {
            "when": "outcome == 'follow_up_needed'",
            "task": "WAT-TASK-FOLLOWUP",
            "schedule": "+24h",
        },
    ],
    "clocks": [],
}
