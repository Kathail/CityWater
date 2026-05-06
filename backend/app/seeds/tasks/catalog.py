"""CityWater keystone task definitions — consolidated catalog.

Seeds the 28 task definitions across water / sewer / storm / general
that flesh out the operator catalog beyond the foundational
``WAT-TASK-DISCOLOURED`` (which keeps its richer form / prefill /
canned-comments definition in ``wat_discoloured.py`` and is excluded
here to avoid clobbering it with a slimmer duplicate).

Trigger caveats — these are intentional no-ops for now:

- SR-category triggers reference categories not yet in the
  ``service_request.category`` CHECK enum (eg ``hydrant_hit``,
  ``basement_backup``, ``meter_issue``). The tasks themselves seed and
  validate fine; manual invocation works. A follow-up migration extends
  the enum so SR-triggered matching becomes live.
- ``from: "program"`` triggers reference programs that don't exist yet —
  harmless until the program engine lands.
- ``from: "asset"`` triggers with a ``status`` filter aren't honoured by
  the match service today (the matcher walks payload keys, but asset
  payloads don't include ``status``).
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models import TaskDefinition

logger = logging.getLogger(__name__)


TASKS: list[dict[str, Any]] = [
    # ---------- WATER DISTRIBUTION ----------
    {
        "code": "WAT-TASK-LOW-PRESSURE",
        "title": "Low Pressure Investigation",
        "summary": (
            "Investigate reported low pressure. Check system, valves, "
            "recent work, and service line."
        ),
        "produces": "work_order",
        "default_category": "investigation",
        "default_priority": "normal",
        "default_domain": "water",
        "applies_to_classes": ["WAT_MAIN", "WAT_SVC", "WAT_HYD"],
        "triggers": [
            {"from": "service_request", "category": "low_pressure"},
        ],
        "smart_comments": [
            {
                "id": "pressure_valve_issue",
                "condition": "valve_position != 'fully_open'",
                "text": (
                    "Found valve partially closed at {valve_location}. "
                    "Opened valve. Pressure restored."
                ),
            },
            {
                "id": "pressure_main_work",
                "condition": "recent_main_work_nearby == true",
                "text": (
                    "Low pressure likely due to recent main work in area. "
                    "System recovering. Monitored pressure."
                ),
            },
            {
                "id": "pressure_service_line",
                "condition": "likely_cause == 'service_line'",
                "text": (
                    "Pressure issue appears to be on customer service line. "
                    "Advised customer to have plumber check."
                ),
            },
            {
                "id": "pressure_resolved",
                "condition": "outcome == 'resolved_on_site'",
                "text": (
                    "Pressure issue resolved. All taps flowing normally. "
                    "Customer satisfied."
                ),
            },
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Check recent work orders and valve positions in area",
                 "auto_complete_when": "area_checked == true"},
                {"n": 2, "title": "Test pressure at hydrant or curb stop",
                 "auto_complete_when": "pressure_tested == true"},
                {"n": 3, "title": "Investigate service line if pressure good at main",
                 "auto_complete_when": "service_line_checked == true"},
                {"n": 4, "title": "Resolve and notify customer",
                 "auto_complete_when": "outcome != null"},
            ],
        },
        "completion": {
            "required_fields": ["pressure_tested", "outcome"],
            "expression": "pressure_tested == true && outcome != null",
        },
    },
    {
        "code": "WAT-TASK-MAIN-BREAK",
        "title": "Water Main Break Response",
        "summary": (
            "Respond to water main break. Isolate, repair, restore service, "
            "notify affected customers."
        ),
        "produces": "work_order",
        "default_category": "main_break",
        "default_priority": "high",
        "default_domain": "water",
        "applies_to_classes": ["WAT_MAIN"],
        "triggers": [
            {"from": "service_request", "category": "main_break"},
            {"from": "asset", "class_code": "WAT_MAIN", "status": "leaking"},
        ],
        "smart_comments": [
            {
                "id": "main_break_isolated",
                "condition": "valves_isolated == true",
                "text": (
                    "Main break isolated using valves at {valve_1} and "
                    "{valve_2}. Repair crew notified."
                ),
            },
            {
                "id": "main_break_repaired",
                "condition": "repair_completed == true",
                "text": (
                    "Main break repaired. Service restored. Flushed affected "
                    "area. Boil water advisory issued if required."
                ),
            },
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Locate and isolate break",
                 "auto_complete_when": "valves_isolated == true"},
                {"n": 2, "title": "Notify affected customers",
                 "auto_complete_when": "customers_notified == true"},
                {"n": 3, "title": "Repair main",
                 "auto_complete_when": "repair_completed == true"},
                {"n": 4, "title": "Flush and restore service",
                 "auto_complete_when": "service_restored == true"},
            ],
        },
        "completion": {
            "required_fields": ["valves_isolated", "repair_completed", "service_restored"],
            "expression": (
                "valves_isolated == true && repair_completed == true && "
                "service_restored == true"
            ),
        },
        "spawns": [
            # Spawn engine creates immediately today; the +7d schedule is
            # informational until deferred scheduling lands with programs.
            {"when": "true", "task": "WAT-TASK-VALVE-EXERCISE",
             "priority": "normal", "schedule": "+7d"},
        ],
    },
    {
        "code": "WAT-TASK-HYDRANT-HIT",
        "title": "Hydrant Hit / Damaged Hydrant",
        "summary": (
            "Respond to damaged hydrant. Assess damage, isolate if leaking, "
            "repair or replace."
        ),
        "produces": "work_order",
        "default_category": "repair",
        "default_priority": "high",
        "default_domain": "water",
        "applies_to_classes": ["WAT_HYD"],
        "triggers": [
            {"from": "service_request", "category": "hydrant_hit"},
            {"from": "service_request", "category": "damaged_hydrant"},
        ],
        "smart_comments": [
            {"id": "hydrant_knocked_over",
             "condition": "hydrant_status == 'knocked_over'",
             "text": "Hydrant knocked over. Isolated valve. Temporary cap installed. Replacement scheduled."},
            {"id": "hydrant_leaking",
             "condition": "hydrant_status == 'leaking'",
             "text": "Hydrant leaking from {damage_location}. Repaired / replaced. Flow tested."},
            {"id": "hydrant_minor_damage",
             "condition": "hydrant_status == 'minor_damage'",
             "text": "Minor damage to hydrant. Repaired on site. Painted and flow tested."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Assess damage and isolate if leaking",
                 "auto_complete_when": "damage_assessed == true"},
                {"n": 2, "title": "Repair or replace hydrant",
                 "auto_complete_when": "hydrant_repaired == true"},
                {"n": 3, "title": "Flow test and paint",
                 "auto_complete_when": "flow_tested == true"},
            ],
        },
        "completion": {
            "required_fields": ["damage_assessed", "hydrant_repaired"],
            "expression": "damage_assessed == true && hydrant_repaired == true",
        },
    },
    {
        "code": "WAT-TASK-VALVE-EXERCISE",
        "title": "Valve Exercising",
        "summary": "Exercise valve to maintain operability. Record turns, condition, and any issues.",
        "produces": "work_order",
        "default_category": "valve_exercise",
        "default_priority": "normal",
        "default_domain": "water",
        "applies_to_classes": ["WAT_VLV"],
        "triggers": [
            {"from": "program", "program_code": "WAT-PROG-VALVE-EXERCISE"},
            {"from": "manual", "domain": "water"},
        ],
        "smart_comments": [
            {"id": "valve_normal",
             "condition": "valve_condition == 'normal'",
             "text": "Valve exercised. {turns} turns. Operates smoothly. No leaks."},
            {"id": "valve_stiff",
             "condition": "valve_condition == 'stiff'",
             "text": "Valve stiff. Exercised with difficulty. {turns} turns. Lubricated. Monitor."},
            {"id": "valve_leaking",
             "condition": "valve_condition == 'leaking'",
             "text": "Valve leaking from {leak_location}. Exercised. Repair scheduled."},
            {"id": "valve_broken",
             "condition": "valve_condition == 'broken'",
             "text": "Valve broken / inoperable. Replacement required."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Locate valve and exercise",
                 "auto_complete_when": "valve_exercised == true"},
                {"n": 2, "title": "Record turns, condition, and leaks",
                 "auto_complete_when": "data_recorded == true"},
                {"n": 3, "title": "Lubricate if needed",
                 "auto_complete_when": "lubricated == true || not_needed == true"},
            ],
        },
        "completion": {
            "required_fields": ["valve_exercised", "data_recorded"],
            "expression": "valve_exercised == true && data_recorded == true",
        },
    },
    {
        "code": "WAT-TASK-HYDRANT-FLUSH",
        "title": "Hydrant Flushing",
        "summary": "Flush hydrant to improve water quality or as scheduled maintenance.",
        "produces": "work_order",
        "default_category": "flushing",
        "default_priority": "normal",
        "default_domain": "water",
        "applies_to_classes": ["WAT_HYD"],
        "triggers": [
            {"from": "service_request", "category": "discoloured_water"},
            {"from": "program", "program_code": "WAT-PROG-HYDRANT-FLUSH"},
        ],
        "smart_comments": [
            {"id": "flush_cleared",
             "condition": "water_quality_improved == true",
             "text": "Flushed hydrant for {flush_minutes} minutes. Water quality improved significantly. Clear at end of flush."},
            {"id": "flush_no_improvement",
             "condition": "water_quality_improved == false",
             "text": "Flushed hydrant for {flush_minutes} minutes. No significant improvement. Escalated to distribution crew."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Open hydrant and flush until clear",
                 "auto_complete_when": "flush_completed == true"},
                {"n": 2, "title": "Record flush time and water quality observations",
                 "auto_complete_when": "data_recorded == true"},
            ],
        },
        "completion": {
            "required_fields": ["flush_completed", "data_recorded"],
            "expression": "flush_completed == true && data_recorded == true",
        },
    },
    {
        "code": "WAT-TASK-HYDRANT-FLOW",
        "title": "Hydrant Flow Testing",
        "summary": "Perform hydrant flow test (NFPA 291). Record static / residual pressure and flow.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "normal",
        "default_domain": "water",
        "applies_to_classes": ["WAT_HYD"],
        "triggers": [
            {"from": "program", "program_code": "WAT-PROG-HYDRANT-FLOW-CYCLE"},
        ],
        "smart_comments": [
            {"id": "flow_good",
             "condition": "flow_gpm >= 1000",
             "text": "Hydrant flow test completed. Flow {flow_gpm} GPM at {residual_psi} psi residual. Color class: {color_class}."},
            {"id": "flow_poor",
             "condition": "flow_gpm < 500",
             "text": "Low flow recorded ({flow_gpm} GPM). Recommend main line flushing or further investigation."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Record static pressure",
                 "auto_complete_when": "static_pressure_recorded == true"},
                {"n": 2, "title": "Flow hydrant and record residual pressure + GPM",
                 "auto_complete_when": "flow_test_completed == true"},
                {"n": 3, "title": "Calculate available flow at 20 psi and determine color class",
                 "auto_complete_when": "calculations_complete == true"},
            ],
        },
        "completion": {
            "required_fields": ["static_pressure_recorded", "flow_test_completed"],
            "expression": "static_pressure_recorded == true && flow_test_completed == true",
        },
    },
    {
        "code": "WAT-TASK-NO-WATER",
        "title": "No Water / Service Interruption",
        "summary": "Investigate complete loss of water. Check main, valves, and service line.",
        "produces": "work_order",
        "default_category": "investigation",
        "default_priority": "high",
        "default_domain": "water",
        "applies_to_classes": ["WAT_MAIN", "WAT_SVC"],
        "triggers": [
            {"from": "service_request", "category": "no_water"},
        ],
        "smart_comments": [
            {"id": "no_water_valve",
             "condition": "valve_closed == true",
             "text": "Found closed valve at {valve_location}. Opened valve. Service restored."},
            {"id": "no_water_main_break",
             "condition": "main_break_found == true",
             "text": "Main break confirmed. Isolated and repair crew dispatched. Affected customers notified."},
            {"id": "no_water_service_line",
             "condition": "service_line_issue == true",
             "text": "No water on customer service line. Advised customer to contact plumber."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Check if area is experiencing outage",
                 "auto_complete_when": "area_checked == true"},
                {"n": 2, "title": "Locate and check valves",
                 "auto_complete_when": "valves_checked == true"},
                {"n": 3, "title": "Investigate service line if main is live",
                 "auto_complete_when": "service_line_checked == true"},
            ],
        },
        "completion": {
            "required_fields": ["area_checked", "outcome"],
            "expression": "area_checked == true && outcome != null",
        },
    },
    {
        "code": "WAT-TASK-SERVICE-LEAK",
        "title": "Service Line Leak",
        "summary": "Investigate and repair leak on customer service line.",
        "produces": "work_order",
        "default_category": "repair",
        "default_priority": "normal",
        "default_domain": "water",
        "applies_to_classes": ["WAT_SVC"],
        "triggers": [
            {"from": "service_request", "category": "service_leak"},
            {"from": "service_request", "category": "wet_area"},
        ],
        "smart_comments": [
            {"id": "service_leak_repaired",
             "condition": "repair_completed == true",
             "text": "Service line leak repaired at {repair_location}. Excavation backfilled and restored."},
            {"id": "service_leak_customer_side",
             "condition": "leak_on_customer_side == true",
             "text": "Leak confirmed on customer side of curb stop. Advised customer to contact plumber."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Locate leak and determine if on utility or customer side",
                 "auto_complete_when": "leak_location_confirmed == true"},
                {"n": 2, "title": "Repair if on utility side",
                 "auto_complete_when": "repair_completed == true || customer_side == true"},
            ],
        },
        "completion": {
            "required_fields": ["leak_location_confirmed", "outcome"],
            "expression": "leak_location_confirmed == true && outcome != null",
        },
    },
    {
        "code": "WAT-TASK-METER-ISSUE",
        "title": "Meter Problem (Stuck, Leaking, Inaccurate)",
        "summary": "Investigate and resolve meter issue (stuck, leaking, or inaccurate reading).",
        "produces": "work_order",
        "default_category": "investigation",
        "default_priority": "normal",
        "default_domain": "water",
        "applies_to_classes": ["WAT_MTR"],
        "triggers": [
            {"from": "service_request", "category": "meter_issue"},
            {"from": "service_request", "category": "high_bill"},
        ],
        "smart_comments": [
            {"id": "meter_replaced",
             "condition": "meter_replaced == true",
             "text": "Meter replaced. Old reading {old_reading}, new meter installed with reading {new_reading}."},
            {"id": "meter_leaking",
             "condition": "meter_leaking == true",
             "text": "Meter leaking from {leak_location}. Replaced meter and restored service."},
            {"id": "meter_stuck",
             "condition": "meter_stuck == true",
             "text": "Meter stuck / not registering. Replaced meter. Tested for flow."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Inspect meter and test for flow",
                 "auto_complete_when": "meter_inspected == true"},
                {"n": 2, "title": "Replace meter if faulty or leaking",
                 "auto_complete_when": "meter_replaced == true || not_needed == true"},
            ],
        },
        "completion": {
            "required_fields": ["meter_inspected", "outcome"],
            "expression": "meter_inspected == true && outcome != null",
        },
    },
    # ---------- WASTEWATER ----------
    {
        "code": "SEW-TASK-BACKUP",
        "title": "Sewer Backup / SSO Response",
        "summary": "Respond to sewer backup. Clear blockage, check for SSO, restore flow, document.",
        "produces": "work_order",
        "default_category": "cleaning",
        "default_priority": "high",
        "default_domain": "sewer",
        "applies_to_classes": ["SAN_MAIN", "SAN_MH", "SAN_LFT"],
        "triggers": [
            {"from": "service_request", "category": "sewer_backup"},
            {"from": "service_request", "category": "basement_backup"},
        ],
        "smart_comments": [
            {"id": "backup_cleared",
             "condition": "backup_cleared == true",
             "text": "Blockage cleared with jetter. Flow restored. Downstream manhole checked clear. No SSO observed."},
            {"id": "backup_grease",
             "condition": "likely_cause == 'grease'",
             "text": "Heavy grease blockage cleared. Customer advised on FOG. Grease trap inspection recommended."},
            {"id": "backup_main_line",
             "condition": "likely_cause == 'main_line'",
             "text": "Main line blockage cleared. CCTV scheduled for further assessment."},
            {"id": "backup_sso_reported",
             "condition": "sso_observed == true",
             "text": "SSO observed and contained. Environmental reporting initiated. Cleanup in progress."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Assess backup and check for SSO",
                 "auto_complete_when": "site_assessed == true"},
                {"n": 2, "title": "Clear blockage (jetter / snake)",
                 "auto_complete_when": "blockage_cleared == true"},
                {"n": 3, "title": "Verify flow restored downstream",
                 "auto_complete_when": "flow_restored == true"},
                {"n": 4, "title": "Document and notify if SSO occurred",
                 "auto_complete_when": "documentation_complete == true"},
            ],
        },
        "completion": {
            "required_fields": ["site_assessed", "blockage_cleared", "flow_restored"],
            "expression": "site_assessed == true && blockage_cleared == true && flow_restored == true",
        },
        "spawns": [
            {"when": "likely_cause == 'grease' || recurring == true",
             "task": "SEW-TASK-CCTV", "priority": "normal"},
        ],
    },
    {
        "code": "SEW-TASK-ODOR",
        "title": "Sewer Odor Complaint",
        "summary": "Investigate sewer odor complaint. Identify source and resolve.",
        "produces": "work_order",
        "default_category": "investigation",
        "default_priority": "normal",
        "default_domain": "sewer",
        # Spec said SEW_LFT — corrected to SAN_LFT (matches migrations/0006).
        "applies_to_classes": ["SAN_MH", "SAN_MAIN", "SAN_LFT"],
        "triggers": [
            {"from": "service_request", "category": "sewer_odor"},
            {"from": "service_request", "category": "odour"},
        ],
        "smart_comments": [
            {"id": "odor_dry_trap",
             "condition": "likely_cause == 'dry_trap'",
             "text": "Odor caused by dry trap in customer plumbing. Advised customer to run water regularly."},
            {"id": "odor_vent_issue",
             "condition": "likely_cause == 'vent_issue'",
             "text": "Odor from plumbing vent. Issue on customer side. Advised to have plumber inspect."},
            {"id": "odor_main_line",
             "condition": "likely_cause == 'main_line'",
             "text": "Odor from main line. Inspected manholes in area. Cleaning / CCTV scheduled."},
            {"id": "odor_lift_station",
             "condition": "likely_cause == 'lift_station'",
             "text": "Odor from lift station. Checked wet well and ventilation. Maintenance scheduled."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Interview customer and locate odor source",
                 "auto_complete_when": "source_located == true"},
                {"n": 2, "title": "Inspect nearby manholes and vents",
                 "auto_complete_when": "area_inspected == true"},
                {"n": 3, "title": "Resolve or refer appropriately",
                 "auto_complete_when": "outcome != null"},
            ],
        },
        "completion": {
            "required_fields": ["source_located", "outcome"],
            "expression": "source_located == true && outcome != null",
        },
    },
    {
        "code": "SEW-TASK-LIFT-STATION",
        "title": "Lift Station Round / Alarm Response",
        "summary": "Perform lift station inspection or respond to alarm. Check pumps, levels, and alarms.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "normal",
        "default_domain": "sewer",
        "applies_to_classes": ["SAN_LFT"],
        "triggers": [
            {"from": "program", "program_code": "SEW-PROG-LIFT-STATION-DAILY"},
            {"from": "service_request", "category": "lift_station_alarm"},
        ],
        "smart_comments": [
            {"id": "lift_normal",
             "condition": "wet_well_level_normal == true && pumps_ok == true",
             "text": "Lift station normal. Wet well level {wet_well_level_m}m. Pump 1 runtime {pump1_runtime_h}h. Pump 2 runtime {pump2_runtime_h}h."},
            {"id": "lift_high_level",
             "condition": "wet_well_level_high == true",
             "text": "High wet well level. Pumps checked. {pumps_running} pump(s) running. Issue resolved / escalated."},
            {"id": "lift_pump_issue",
             "condition": "pump_issue == true",
             "text": "Pump issue detected on Pump {affected_pump}. Amps {amps}A. Repair / replacement required."},
            {"id": "lift_odor",
             "condition": "odor_complaint == true",
             "text": "Odor complaint at lift station. Wet well checked. Ventilation / odor control inspected."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Check wet well level and pumps",
                 "auto_complete_when": "wet_well_checked == true"},
                {"n": 2, "title": "Record pump runtimes and amps",
                 "auto_complete_when": "data_recorded == true"},
                {"n": 3, "title": "Test generator and check alarms",
                 "auto_complete_when": "generator_tested == true"},
                {"n": 4, "title": "Resolve any issues found",
                 "auto_complete_when": "issues_resolved == true || no_issues == true"},
            ],
        },
        "completion": {
            "required_fields": ["wet_well_checked", "data_recorded"],
            "expression": "wet_well_checked == true && data_recorded == true",
        },
    },
    {
        "code": "SEW-TASK-MANHOLE-INSPECT",
        "title": "Manhole Inspection",
        "summary": "Inspect manhole condition. Record structural condition, infiltration, and H2S levels.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "normal",
        "default_domain": "sewer",
        "applies_to_classes": ["SAN_MH", "STM_MH"],
        "triggers": [
            {"from": "program", "program_code": "SEW-PROG-MANHOLE-INSPECT"},
            {"from": "service_request", "category": "manhole_issue"},
        ],
        "smart_comments": [
            {"id": "manhole_good",
             "condition": "overall_condition <= 2",
             "text": "Manhole in good condition. Frame / cover {frame_condition}, chimney {chimney_condition}, bench {bench_condition}."},
            {"id": "manhole_poor",
             "condition": "overall_condition >= 4",
             "text": "Manhole in poor condition. Recommend rehabilitation or replacement. Infiltration {infiltration_lpm} LPM."},
            {"id": "manhole_h2s",
             "condition": "h2s_ppm > 5",
             "text": "Elevated H2S levels detected ({h2s_ppm} ppm). Recommend odor control assessment."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Open manhole and inspect structure",
                 "auto_complete_when": "manhole_inspected == true"},
                {"n": 2, "title": "Record condition ratings and infiltration",
                 "auto_complete_when": "data_recorded == true"},
                {"n": 3, "title": "Check for H2S and odour",
                 "auto_complete_when": "h2s_checked == true"},
            ],
        },
        "completion": {
            "required_fields": ["manhole_inspected", "data_recorded"],
            "expression": "manhole_inspected == true && data_recorded == true",
        },
    },
    {
        "code": "SEW-TASK-CCTV",
        "title": "CCTV / PACP Inspection",
        "summary": "Perform CCTV inspection of sewer main. Record PACP observations and ratings.",
        "produces": "inspection",
        "default_priority": "normal",
        "default_domain": "sewer",
        "applies_to_classes": ["SAN_MAIN", "STM_MAIN"],
        "triggers": [
            {"from": "service_request", "category": "sewer_backup"},
            {"from": "program", "program_code": "SEW-PROG-CCTV-CYCLE"},
        ],
        "smart_comments": [
            {"id": "cctv_clean",
             "condition": "structural_total <= 5 && om_total <= 5",
             "text": "CCTV inspection complete. Pipe in good condition. {length_surveyed_m}m surveyed. No significant defects."},
            {"id": "cctv_structural_defects",
             "condition": "structural_total > 10",
             "text": "Significant structural defects found. Structural rating {structural_qr}. Recommend rehabilitation."},
            {"id": "cctv_grease",
             "condition": "grease_observed == true",
             "text": "Heavy grease observed. {grease_length_m}m affected. Cleaning recommended."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Set up and perform CCTV survey",
                 "auto_complete_when": "survey_completed == true"},
                {"n": 2, "title": "Record observations and generate PACP ratings",
                 "auto_complete_when": "ratings_complete == true"},
                {"n": 3, "title": "Recommend follow-up actions if needed",
                 "auto_complete_when": "recommendations_complete == true"},
            ],
        },
        "completion": {
            "required_fields": ["survey_completed", "ratings_complete"],
            "expression": "survey_completed == true && ratings_complete == true",
        },
    },
    {
        "code": "SEW-TASK-GREASE-TRAP",
        "title": "Grease Trap Inspection / Issue",
        "summary": "Inspect grease trap and address FOG issues.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "normal",
        "default_domain": "sewer",
        "applies_to_classes": ["SAN_GT"],
        "triggers": [
            {"from": "service_request", "category": "grease_trap"},
            {"from": "service_request", "category": "fats_oils_grease"},
        ],
        "smart_comments": [
            {"id": "grease_trap_cleaned",
             "condition": "trap_cleaned == true",
             "text": "Grease trap cleaned. {sediment_depth_cm}cm sediment and {grease_depth_cm}cm grease removed."},
            {"id": "grease_trap_undersized",
             "condition": "trap_undersized == true",
             "text": "Grease trap appears undersized for current usage. Recommend upgrade or increased cleaning frequency."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Inspect grease trap condition and levels",
                 "auto_complete_when": "trap_inspected == true"},
                {"n": 2, "title": "Clean trap if required",
                 "auto_complete_when": "trap_cleaned == true || not_needed == true"},
                {"n": 3, "title": "Educate customer on proper FOG disposal",
                 "auto_complete_when": "customer_educated == true"},
            ],
        },
        "completion": {
            "required_fields": ["trap_inspected", "outcome"],
            "expression": "trap_inspected == true && outcome != null",
        },
    },
    {
        "code": "SEW-TASK-FORCE-MAIN",
        "title": "Force Main Issue",
        "summary": "Respond to force main problem (leak, break, high pressure, air lock).",
        "produces": "work_order",
        "default_category": "investigation",
        "default_priority": "high",
        "default_domain": "sewer",
        "applies_to_classes": ["SAN_FM"],
        "triggers": [
            {"from": "service_request", "category": "force_main_issue"},
            {"from": "asset", "class_code": "SAN_FM", "status": "leaking"},
        ],
        "smart_comments": [
            {"id": "force_main_leak",
             "condition": "leak_found == true",
             "text": "Force main leak located at {leak_location}. Isolated section. Repair crew dispatched."},
            {"id": "force_main_air_lock",
             "condition": "air_lock == true",
             "text": "Air lock detected in force main. Air release valve exercised. Flow restored."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Investigate force main issue",
                 "auto_complete_when": "issue_investigated == true"},
                {"n": 2, "title": "Isolate if leaking and dispatch repair",
                 "auto_complete_when": "issue_resolved == true || repair_dispatched == true"},
            ],
        },
        "completion": {
            "required_fields": ["issue_investigated", "outcome"],
            "expression": "issue_investigated == true && outcome != null",
        },
    },
    {
        "code": "SEW-TASK-SLOW-DRAIN",
        "title": "Slow Draining / Partial Blockage",
        "summary": "Investigate and clear partial blockage causing slow drainage.",
        "produces": "work_order",
        "default_category": "cleaning",
        "default_priority": "normal",
        "default_domain": "sewer",
        "applies_to_classes": ["SAN_MAIN", "SAN_LAT"],
        "triggers": [
            {"from": "service_request", "category": "slow_drain"},
        ],
        "smart_comments": [
            {"id": "slow_drain_cleared",
             "condition": "blockage_cleared == true",
             "text": "Partial blockage cleared. Drainage restored. Customer advised on what not to flush."},
            {"id": "slow_drain_recurring",
             "condition": "recurring_issue == true",
             "text": "Recurring slow drain issue. CCTV recommended for further investigation."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Locate and clear partial blockage",
                 "auto_complete_when": "blockage_cleared == true"},
                {"n": 2, "title": "Verify drainage restored",
                 "auto_complete_when": "drainage_restored == true"},
            ],
        },
        "completion": {
            "required_fields": ["blockage_cleared", "drainage_restored"],
            "expression": "blockage_cleared == true && drainage_restored == true",
        },
    },
    # ---------- STORMWATER ----------
    {
        "code": "STM-TASK-POST-STORM-CB",
        "title": "Post-Storm Catch Basin Inspection",
        "summary": "Inspect catch basins after storm event for damage, blockage, and debris.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "high",
        "default_domain": "storm",
        "applies_to_classes": ["STM_CB"],
        "triggers": [
            {"from": "program", "program_code": "STM-PROG-POST-STORM-CB"},
            {"from": "service_request", "category": "post_storm_flooding"},
        ],
        "smart_comments": [
            {"id": "cb_post_storm_clear",
             "condition": "basin_clear == true",
             "text": "Catch basin clear after storm. No significant debris or damage. Drainage functioning normally."},
            {"id": "cb_post_storm_blocked",
             "condition": "basin_blocked == true",
             "text": "Catch basin blocked with debris / sediment after storm. Cleared on site. Drainage restored."},
            {"id": "cb_post_storm_damaged",
             "condition": "basin_damaged == true",
             "text": "Catch basin damaged during storm event. Grate / frame issue noted. Repair scheduled."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Inspect catch basin for debris, sediment, and damage",
                 "auto_complete_when": "basin_inspected == true"},
                {"n": 2, "title": "Clear blockage if present",
                 "auto_complete_when": "basin_cleared == true || no_blockage == true"},
                {"n": 3, "title": "Document condition and any required follow-up",
                 "auto_complete_when": "documentation_complete == true"},
            ],
        },
        "completion": {
            "required_fields": ["basin_inspected", "documentation_complete"],
            "expression": "basin_inspected == true && documentation_complete == true",
        },
    },
    {
        "code": "STM-TASK-CB-CLOGGED",
        "title": "Clogged Catch Basin",
        "summary": "Clear clogged catch basin causing flooding or ponding.",
        "produces": "work_order",
        "default_category": "cleaning",
        "default_priority": "normal",
        "default_domain": "storm",
        "applies_to_classes": ["STM_CB"],
        "triggers": [
            {"from": "service_request", "category": "flooding"},
            {"from": "service_request", "category": "clogged_catch_basin"},
        ],
        "smart_comments": [
            {"id": "cb_cleared",
             "condition": "basin_cleared == true",
             "text": "Catch basin cleared. {sediment_volume} removed. Grate and outlet clear. Drainage restored."},
            {"id": "cb_heavy_sediment",
             "condition": "sediment_depth_m > 0.3",
             "text": "Heavy sediment accumulation ({sediment_depth_m}m). Recommend increased cleaning frequency for this basin."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Remove grate and clear debris / sediment",
                 "auto_complete_when": "basin_cleared == true"},
                {"n": 2, "title": "Check outlet pipe for blockage",
                 "auto_complete_when": "outlet_checked == true"},
                {"n": 3, "title": "Verify drainage restored",
                 "auto_complete_when": "drainage_restored == true"},
            ],
        },
        "completion": {
            "required_fields": ["basin_cleared", "drainage_restored"],
            "expression": "basin_cleared == true && drainage_restored == true",
        },
    },
    {
        "code": "STM-TASK-CB-INSPECT",
        "title": "Catch Basin Inspection",
        "summary": "Inspect catch basin condition and sediment levels.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "normal",
        "default_domain": "storm",
        "applies_to_classes": ["STM_CB"],
        "triggers": [
            {"from": "program", "program_code": "STM-PROG-CB-INSPECT"},
        ],
        "smart_comments": [
            {"id": "cb_good",
             "condition": "sediment_depth_m < 0.15 && grate_good == true",
             "text": "Catch basin in good condition. Sediment {sediment_depth_m}m. Grate and outlet clear."},
            {"id": "cb_needs_cleaning",
             "condition": "sediment_depth_m > 0.25 || needs_cleaning == true",
             "text": "Catch basin needs cleaning. Sediment {sediment_depth_m}m. Cleaning scheduled."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Remove grate and measure sediment",
                 "auto_complete_when": "sediment_measured == true"},
                {"n": 2, "title": "Inspect grate, frame, and outlet",
                 "auto_complete_when": "structure_inspected == true"},
            ],
        },
        "completion": {
            "required_fields": ["sediment_measured", "structure_inspected"],
            "expression": "sediment_measured == true && structure_inspected == true",
        },
    },
    {
        "code": "STM-TASK-DITCH-CLEAN",
        "title": "Ditch / Swale Cleaning",
        "summary": "Clean ditch or swale to restore flow capacity.",
        "produces": "work_order",
        "default_category": "cleaning",
        "default_priority": "normal",
        "default_domain": "storm",
        "applies_to_classes": ["STM_DTCH", "STM_BMP"],
        "triggers": [
            {"from": "service_request", "category": "ditch_flooding"},
            {"from": "program", "program_code": "STM-PROG-DITCH-CLEAN"},
        ],
        "smart_comments": [
            {"id": "ditch_cleaned",
             "condition": "ditch_cleaned == true",
             "text": "Ditch cleaned. Vegetation and debris removed. Flow capacity restored. {length_cleaned_m}m cleaned."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Remove vegetation and debris from ditch",
                 "auto_complete_when": "ditch_cleaned == true"},
                {"n": 2, "title": "Verify flow path is clear",
                 "auto_complete_when": "flow_path_clear == true"},
            ],
        },
        "completion": {
            "required_fields": ["ditch_cleaned", "flow_path_clear"],
            "expression": "ditch_cleaned == true && flow_path_clear == true",
        },
    },
    {
        "code": "STM-TASK-CULVERT",
        "title": "Culvert Inspection / Blockage",
        "summary": "Inspect culvert and clear blockage if present.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "normal",
        "default_domain": "storm",
        "applies_to_classes": ["STM_CULV"],
        "triggers": [
            {"from": "service_request", "category": "culvert_issue"},
            {"from": "service_request", "category": "road_flooding"},
        ],
        "smart_comments": [
            {"id": "culvert_cleared",
             "condition": "culvert_cleared == true",
             "text": "Culvert cleared. Debris removed from inlet and outlet. Flow restored."},
            {"id": "culvert_damaged",
             "condition": "culvert_damaged == true",
             "text": "Culvert damaged. Recommend repair or replacement. Temporary measures installed."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Inspect culvert inlet and outlet",
                 "auto_complete_when": "culvert_inspected == true"},
                {"n": 2, "title": "Clear blockage if present",
                 "auto_complete_when": "culvert_cleared == true || no_blockage == true"},
            ],
        },
        "completion": {
            "required_fields": ["culvert_inspected", "outcome"],
            "expression": "culvert_inspected == true && outcome != null",
        },
    },
    {
        "code": "STM-TASK-OUTFALL",
        "title": "Outfall Inspection",
        "summary": "Inspect stormwater outfall for condition, erosion, and illicit discharge.",
        "produces": "work_order",
        "default_category": "inspection",
        "default_priority": "normal",
        "default_domain": "storm",
        "applies_to_classes": ["STM_OUT"],
        "triggers": [
            {"from": "program", "program_code": "STM-PROG-OUTFALL-INSPECT"},
        ],
        "smart_comments": [
            {"id": "outfall_good",
             "condition": "overall_condition <= 2",
             "text": "Outfall in good condition. No significant erosion or illicit discharge observed."},
            {"id": "outfall_erosion",
             "condition": "erosion_present == true",
             "text": "Erosion observed at outfall. Recommend stabilization measures."},
            {"id": "outfall_discharge",
             "condition": "illicit_discharge == true",
             "text": "Potential illicit discharge observed. Reported for further investigation."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Inspect outfall structure and surrounding area",
                 "auto_complete_when": "outfall_inspected == true"},
                {"n": 2, "title": "Check for erosion and illicit discharge",
                 "auto_complete_when": "checks_complete == true"},
            ],
        },
        "completion": {
            "required_fields": ["outfall_inspected", "checks_complete"],
            "expression": "outfall_inspected == true && checks_complete == true",
        },
    },
    # ---------- GENERAL / CROSS-DOMAIN ----------
    {
        "code": "GEN-TASK-CUSTOMER-COMPLAINT",
        "title": "General Customer Complaint",
        "summary": "Investigate and resolve general customer complaint not covered by specific task types.",
        "produces": "work_order",
        "default_category": "investigation",
        "default_priority": "normal",
        "default_domain": "any",
        "applies_to_classes": [],
        "triggers": [
            {"from": "service_request", "category": "general_complaint"},
        ],
        "smart_comments": [
            {"id": "complaint_resolved",
             "condition": "outcome == 'resolved'",
             "text": "Customer complaint investigated and resolved. Customer satisfied."},
            {"id": "complaint_referred",
             "condition": "outcome == 'referred'",
             "text": "Customer complaint referred to appropriate department / external party."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Investigate complaint and determine root cause",
                 "auto_complete_when": "investigation_complete == true"},
                {"n": 2, "title": "Resolve or refer appropriately",
                 "auto_complete_when": "outcome != null"},
            ],
        },
        "completion": {
            "required_fields": ["investigation_complete", "outcome"],
            "expression": "investigation_complete == true && outcome != null",
        },
    },
    {
        "code": "GEN-TASK-AFTER-HOURS",
        "title": "After Hours / Emergency Callout",
        "summary": "Respond to after-hours emergency or urgent call.",
        "produces": "work_order",
        "default_category": "other",
        "default_priority": "high",
        "default_domain": "any",
        "applies_to_classes": [],
        "triggers": [
            # `priority` and `time` aren't keys the match service inspects
            # today; these triggers will become live once those keys are
            # added to the SR match payload. Manual invocation works now.
            {"from": "service_request", "priority": "emergency"},
            {"from": "service_request", "time": "after_hours"},
        ],
        "smart_comments": [
            {"id": "after_hours_resolved",
             "condition": "issue_resolved == true",
             "text": "After-hours call responded to. Issue resolved / made safe. Follow-up scheduled for normal hours."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Respond to after-hours call and assess situation",
                 "auto_complete_when": "situation_assessed == true"},
                {"n": 2, "title": "Make safe and / or resolve immediate issue",
                 "auto_complete_when": "issue_resolved == true || made_safe == true"},
            ],
        },
        "completion": {
            "required_fields": ["situation_assessed", "outcome"],
            "expression": "situation_assessed == true && outcome != null",
        },
    },
    {
        "code": "GEN-TASK-FOLLOW-UP",
        "title": "Follow-up Work",
        "summary": "Complete follow-up work from previous job that was not fully resolved.",
        "produces": "work_order",
        "default_category": "other",
        "default_priority": "normal",
        "default_domain": "any",
        "applies_to_classes": [],
        "triggers": [
            {"from": "work_order", "status": "completed", "follow_up_needed": True},
        ],
        "smart_comments": [
            {"id": "follow_up_completed",
             "condition": "follow_up_completed == true",
             "text": "Follow-up work completed. Original issue now fully resolved."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Review previous work order and complete outstanding items",
                 "auto_complete_when": "follow_up_completed == true"},
            ],
        },
        "completion": {
            "required_fields": ["follow_up_completed"],
            "expression": "follow_up_completed == true",
        },
    },
    {
        "code": "GEN-TASK-LOCATE",
        "title": "Utility Locate Request",
        "summary": "Respond to utility locate request (811 ticket, excavation, construction).",
        "produces": "work_order",
        "default_category": "other",
        "default_priority": "normal",
        "default_domain": "any",
        "applies_to_classes": [],
        "triggers": [
            {"from": "service_request", "category": "locate_request"},
        ],
        "smart_comments": [
            {"id": "locate_completed",
             "condition": "locate_completed == true",
             "text": "Utility locate completed. All utilities marked. Ticket closed."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Locate and mark all utilities in requested area",
                 "auto_complete_when": "locate_completed == true"},
            ],
        },
        "completion": {
            "required_fields": ["locate_completed"],
            "expression": "locate_completed == true",
        },
    },
    {
        "code": "GEN-TASK-DAMAGE",
        "title": "Third Party Damage Investigation",
        "summary": "Investigate and document third party damage to utility infrastructure.",
        "produces": "work_order",
        "default_category": "investigation",
        "default_priority": "high",
        "default_domain": "any",
        "applies_to_classes": [],
        "triggers": [
            {"from": "service_request", "category": "third_party_damage"},
            {"from": "service_request", "category": "dig_in"},
        ],
        "smart_comments": [
            {"id": "damage_documented",
             "condition": "damage_documented == true",
             "text": "Third party damage documented. Photos taken. Report filed for insurance / contractor claim."},
        ],
        "procedure": {
            "steps": [
                {"n": 1, "title": "Document damage with photos and measurements",
                 "auto_complete_when": "damage_documented == true"},
                {"n": 2, "title": "Make safe and schedule permanent repair",
                 "auto_complete_when": "made_safe == true"},
            ],
        },
        "completion": {
            "required_fields": ["damage_documented", "made_safe"],
            "expression": "damage_documented == true && made_safe == true",
        },
    },
]


def seed_tasks(session: Session, tenant_id: int) -> tuple[int, int]:
    """Idempotently seed every task in TASKS for the given tenant.

    Returns ``(created, skipped)``. A task is skipped when an active
    version with the same ``code`` already exists for the tenant — this
    is what protects ``WAT-TASK-DISCOLOURED`` from being clobbered by a
    leaner duplicate, even if it's later added to ``TASKS``.
    """
    created = 0
    skipped = 0

    for spec in TASKS:
        existing = (
            session.query(TaskDefinition)
            .filter(
                TaskDefinition.tenant_id == tenant_id,
                TaskDefinition.code == spec["code"],
                TaskDefinition.status == "active",
                TaskDefinition.deleted_at.is_(None),
            )
            .first()
        )
        if existing:
            skipped += 1
            continue

        td = TaskDefinition(
            tenant_id=tenant_id,
            code=spec["code"],
            version=spec.get("version", 1),
            status="active",
            title=spec["title"],
            summary=spec.get("summary"),
            produces=spec["produces"],
            default_category=spec.get("default_category"),
            default_priority=spec.get("default_priority", "normal"),
            default_domain=spec.get("default_domain"),
            applies_to_classes=spec.get("applies_to_classes", []),
            triggers=spec.get("triggers", []),
            prefill=spec.get("prefill", {}),
            form=spec.get("form", []),
            canned_comments=spec.get("canned_comments", []),
            smart_comments=spec.get("smart_comments", []),
            procedure=spec.get("procedure", {}),
            completion=spec.get("completion", {}),
            spawns=spec.get("spawns", []),
            clocks=spec.get("clocks", []),
        )
        session.add(td)
        created += 1

    if created:
        logger.info("seeded %d task definitions for tenant %d", created, tenant_id)
    return created, skipped
