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
    # Suggestive only — chips render in the comment composer at task
    # complete. Operator taps to insert, may edit or ignore. Variables
    # render as `?` if missing from task_data so the gap is visible.
    "smart_comments": [
        {
            "id": "discoloured_cleared",
            "condition": "cold_outcome == 'cleared'",
            "text": (
                "Ran cold tap for {cold_run_minutes} min until water ran "
                "clear. Verified Cl2 residual at {chlorine_residual} ppm. "
                "Customer notified."
            ),
            "variables": ["cold_run_minutes", "chlorine_residual"],
        },
        {
            "id": "discoloured_resolved_via_flush",
            "condition": (
                "cold_outcome == 'still_discoloured' && flush_minutes > 0 "
                "&& outcome == 'resolved_on_site'"
            ),
            "text": (
                "Cold tap did not clear after {cold_run_minutes} min. "
                "Flushed nearest hydrant for {flush_minutes} min. "
                "Cl2 residual {chlorine_residual} ppm. Resolved on site."
            ),
            "variables": [
                "cold_run_minutes",
                "flush_minutes",
                "chlorine_residual",
            ],
        },
        {
            "id": "discoloured_still_bad",
            "condition": (
                "cold_outcome == 'still_discoloured' "
                "&& outcome == 'follow_up_needed'"
            ),
            "text": (
                "Cold tap run for {cold_run_minutes} min with no improvement. "
                "Flushed nearest hydrant for {flush_minutes} min. "
                "Distribution crew follow-up required."
            ),
            "variables": ["cold_run_minutes", "flush_minutes"],
        },
        {
            "id": "discoloured_internal_plumbing",
            "condition": (
                "likely_cause == 'internal_plumbing' "
                "|| outcome == 'referred_internal_plumbing'"
            ),
            "text": (
                "Symptoms isolated to internal plumbing. "
                "No distribution-side action required. "
                "Referred to property owner."
            ),
            "variables": [],
        },
        {
            "id": "discoloured_recent_main_work",
            "condition": "likely_cause == 'recent_main_work'",
            "text": (
                "Discolouration consistent with recent main work in area. "
                "Flushed for {flush_minutes} min; "
                "Cl2 residual {chlorine_residual} ppm."
            ),
            "variables": ["flush_minutes", "chlorine_residual"],
        },
        {
            "id": "discoloured_hydrant_use",
            "condition": "likely_cause == 'hydrant_use'",
            "text": (
                "Likely caused by recent hydrant use upstream. "
                "Cleared after running cold tap for {cold_run_minutes} min."
            ),
            "variables": ["cold_run_minutes"],
        },
        {
            "id": "discoloured_fire_flow",
            "condition": "likely_cause == 'fire_flow'",
            "text": (
                "Discolouration consistent with recent fire flow event. "
                "Flushed nearest hydrant for {flush_minutes} min; "
                "Cl2 residual {chlorine_residual} ppm."
            ),
            "variables": ["flush_minutes", "chlorine_residual"],
        },
    ],
    "procedure": {
        "preconditions": ["Confirm address and customer contact"],
        "ppe": ["safety vest"],
        "tools_materials": [{"item": "AWWA spanner wrench", "qty": 1}],
        "steps": [
            {
                "n": 1,
                "title": "Contact customer at site",
                "auto_complete_when": "site_visited == true",
                "comment_when_checked": "Made contact with customer on site.",
            },
            {
                "n": 2,
                "title": "Run cold tap until clear or 10 min",
                "auto_complete_when": "cold_run_minutes >= 10 || cold_outcome == 'cleared'",
                "comment_when_checked": "Ran cold tap for {cold_run_minutes} min — outcome: {cold_outcome}.",
            },
            {
                "n": 3,
                "title": "Locate nearest hydrant",
                "auto_complete_when": "hydrant_flushed != null",
                "comment_when_checked": "Located nearest hydrant ({hydrant_flushed}).",
            },
            {
                "n": 4,
                "title": "Flush hydrant until clear",
                "auto_complete_when": "flush_minutes > 0",
                "comment_when_checked": "Flushed hydrant for {flush_minutes} min until clear.",
            },
            {
                "n": 5,
                "title": "Verify Cl2 residual >= 0.05 ppm",
                "auto_complete_when": "chlorine_residual >= 0.05",
                "comment_when_checked": "Verified Cl2 residual at {chlorine_residual} ppm.",
            },
            {
                "n": 6,
                "title": "Determine outcome and notify customer",
                "auto_complete_when": "outcome != null",
                "comment_when_checked": "Outcome: {outcome}. Customer notified.",
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
