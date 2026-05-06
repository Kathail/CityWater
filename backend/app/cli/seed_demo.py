"""Seed a `demo` tenant with realistic data for local exploration.

    flask --app app.wsgi seed-demo               # creates if missing
    flask --app app.wsgi seed-demo --force       # wipes the demo tenant first

Coordinates cluster around the Chesapeake Bay area (matches the map default
center) so the assets land somewhere visible on the OSM basemap.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import click
from flask import Flask, g
from flask.cli import with_appcontext
from sqlalchemy import select

from app.extensions import db
from app.models import (
    Asset,
    Crew,
    Inspection,
    Role,
    ServiceRequest,
    Tenant,
    User,
    UserRole,
    WorkOrder,
    WorkOrderMaterial,
    WorkOrderTask,
    WorkOrderTimeLog,
    WoTemplate,
)
from app.services.asset_uid import next_asset_uid
from app.services.auth import hash_password
from app.services.geometry import geojson_to_wkb
from app.services.inspection_number import next_inspection_number
from app.services.sr_number import next_sr_number
from app.services.wo_number import next_wo_number
from app.utils.uids import generate_user_uid

# Annapolis, MD ish — Chesapeake Bay area, matches map DEFAULT_CENTER.
LON = -76.49
LAT = 38.97

DEMO_SLUG = "demo"
DEMO_NAME = "Bayside Water Authority"
ADMIN_EMAIL = "admin@demo.flowops.io"
ADMIN_PASSWORD = "DemoPassword123!"
TECH_EMAIL = "tech@demo.flowops.io"
SUP_EMAIL = "supervisor@demo.flowops.io"
INTAKE_EMAIL = "intake@demo.flowops.io"

ROLE_DEFS = [
    ("admin", "Administrator"),
    ("supervisor", "Supervisor"),
    ("tech", "Field tech"),
    ("readonly", "Read only"),
    ("intake", "Service intake"),
]


def _jitter(base: float, magnitude: float = 0.01) -> float:
    return base + (random.random() - 0.5) * 2 * magnitude


def _point(lon: float, lat: float) -> dict:
    return {"type": "Point", "coordinates": [lon, lat]}


def _line(pts: list[tuple[float, float]]) -> dict:
    return {"type": "LineString", "coordinates": [list(p) for p in pts]}


def _polygon(pts: list[tuple[float, float]]) -> dict:
    return {"type": "Polygon", "coordinates": [[*[list(p) for p in pts], list(pts[0])]]}


def _make_asset(
    *,
    tenant_id: int,
    class_code: str,
    geom: dict,
    **fields,
) -> Asset:
    asset_uid = fields.pop("asset_uid", None) or next_asset_uid(
        tenant_id=tenant_id, class_code=class_code
    )
    asset = Asset(
        tenant_id=tenant_id,
        asset_uid=asset_uid,
        class_code=class_code,
        geom=geojson_to_wkb(geom),
        status=fields.pop("status", "active"),
        attrs=fields.pop("attrs", {}),
        **fields,
    )
    db.session.add(asset)
    return asset


def _wipe_demo() -> None:
    g.skip_tenant_filter = True
    g.tenant_id = None
    existing = db.session.scalar(select(Tenant).where(Tenant.slug == DEMO_SLUG))
    if not existing:
        return
    # Order matters because of FKs; cascading via models would be nicer but a
    # direct purge is fine for a dev seed.
    tenant_id = existing.id
    db.session.execute(Inspection.__table__.delete().where(Inspection.tenant_id == tenant_id))
    db.session.execute(
        WorkOrderTask.__table__.delete().where(
            WorkOrderTask.work_order_id.in_(
                select(WorkOrder.id).where(WorkOrder.tenant_id == tenant_id)
            )
        )
    )
    db.session.execute(
        WorkOrderTimeLog.__table__.delete().where(
            WorkOrderTimeLog.work_order_id.in_(
                select(WorkOrder.id).where(WorkOrder.tenant_id == tenant_id)
            )
        )
    )
    db.session.execute(
        WorkOrderMaterial.__table__.delete().where(
            WorkOrderMaterial.work_order_id.in_(
                select(WorkOrder.id).where(WorkOrder.tenant_id == tenant_id)
            )
        )
    )
    db.session.execute(WorkOrder.__table__.delete().where(WorkOrder.tenant_id == tenant_id))
    db.session.execute(
        ServiceRequest.__table__.delete().where(ServiceRequest.tenant_id == tenant_id)
    )
    db.session.execute(WoTemplate.__table__.delete().where(WoTemplate.tenant_id == tenant_id))
    db.session.execute(Asset.__table__.delete().where(Asset.tenant_id == tenant_id))
    db.session.execute(Crew.__table__.delete().where(Crew.tenant_id == tenant_id))
    db.session.execute(
        UserRole.__table__.delete().where(
            UserRole.user_id.in_(select(User.id).where(User.tenant_id == tenant_id))
        )
    )
    db.session.execute(User.__table__.delete().where(User.tenant_id == tenant_id))
    db.session.execute(Role.__table__.delete().where(Role.tenant_id == tenant_id))
    db.session.execute(Tenant.__table__.delete().where(Tenant.id == tenant_id))
    db.session.commit()


def _seed() -> None:
    g.skip_tenant_filter = True
    random.seed(42)  # stable output across runs

    tenant = Tenant(name=DEMO_NAME, slug=DEMO_SLUG, settings={"locale": "en-US"})
    db.session.add(tenant)
    db.session.flush()
    g.tenant_id = tenant.id

    # Roles
    role_objs = {}
    for code, name in ROLE_DEFS:
        r = Role(tenant_id=tenant.id, code=code, name=name)
        db.session.add(r)
        role_objs[code] = r
    db.session.flush()

    # Users
    def _make_user(email: str, full_name: str, role_codes: list[str]) -> User:
        u = User(
            tenant_id=tenant.id,
            user_uid=generate_user_uid(),
            email=email,
            password_hash=hash_password(ADMIN_PASSWORD),
            full_name=full_name,
            is_active=True,
        )
        db.session.add(u)
        db.session.flush()
        for code in role_codes:
            db.session.add(UserRole(user_id=u.id, role_id=role_objs[code].id))
        return u

    admin = _make_user(ADMIN_EMAIL, "Admin Pearson", ["admin"])
    supervisor = _make_user(SUP_EMAIL, "Sara Vega", ["supervisor"])
    tech = _make_user(TECH_EMAIL, "Tom Fields", ["tech"])
    intake = _make_user(INTAKE_EMAIL, "Iris Park", ["intake"])
    db.session.flush()

    # Crew
    crew = Crew(tenant_id=tenant.id, name="North Crew", lead_user_id=supervisor.id)
    db.session.add(crew)
    db.session.flush()

    # Assets — realistic spread
    # 12 hydrants in a grid
    for i in range(12):
        col, row = divmod(i, 4)
        _make_asset(
            tenant_id=tenant.id,
            class_code="WAT_HYD",
            geom=_point(LON + col * 0.004, LAT + row * 0.003),
            material="ductile iron",
            diameter_mm=150,
            install_date=datetime(2010 + i, 4, 15).date(),
            condition=random.choice([1, 2, 2, 3]),
            criticality=random.choice([2, 3, 3, 4]),
        )

    # 4 water valves
    for _i in range(4):
        _make_asset(
            tenant_id=tenant.id,
            class_code="WAT_VLV",
            geom=_point(_jitter(LON + 0.005, 0.008), _jitter(LAT + 0.002, 0.005)),
            material="ductile iron",
            diameter_mm=200,
            condition=2,
            attrs={"subtype": random.choice(["gate", "butterfly", "check"])},
        )

    # 2 water mains (lines)
    _make_asset(
        tenant_id=tenant.id,
        class_code="WAT_MAIN",
        geom=_line([(LON, LAT), (LON + 0.012, LAT + 0.001), (LON + 0.018, LAT + 0.005)]),
        material="PVC",
        diameter_mm=300,
        length_m=Decimal("1820.5"),
        condition=2,
    )
    _make_asset(
        tenant_id=tenant.id,
        class_code="WAT_MAIN",
        geom=_line(
            [(LON + 0.005, LAT - 0.002), (LON + 0.010, LAT + 0.004), (LON + 0.015, LAT + 0.008)]
        ),
        material="ductile iron",
        diameter_mm=400,
        length_m=Decimal("1240.0"),
        condition=3,
    )

    # 1 reservoir (polygon)
    _make_asset(
        tenant_id=tenant.id,
        class_code="WAT_RES",
        geom=_polygon(
            [
                (LON - 0.005, LAT + 0.008),
                (LON - 0.001, LAT + 0.008),
                (LON - 0.001, LAT + 0.011),
                (LON - 0.005, LAT + 0.011),
            ]
        ),
        material="reinforced concrete",
        condition=2,
    )

    # 8 sanitary manholes
    for _i in range(8):
        _make_asset(
            tenant_id=tenant.id,
            class_code="SAN_MH",
            geom=_point(_jitter(LON + 0.003, 0.012), _jitter(LAT - 0.001, 0.008)),
            depth_m=Decimal(str(round(random.uniform(2.0, 5.5), 1))),
            condition=random.choice([1, 2, 3, 3, 4]),
        )

    # 1 lift station
    _make_asset(
        tenant_id=tenant.id,
        class_code="SAN_LFT",
        geom=_point(LON + 0.020, LAT - 0.004),
        manufacturer="Smith Pump",
        model="LP-2400",
        install_date=datetime(2015, 6, 1).date(),
        condition=2,
    )

    # 6 storm catch basins
    for _ in range(6):
        _make_asset(
            tenant_id=tenant.id,
            class_code="STM_CB",
            geom=_point(_jitter(LON + 0.004, 0.010), _jitter(LAT + 0.005, 0.006)),
            condition=random.choice([2, 2, 3, 4]),
        )

    # 1 outfall + 1 storm main
    _make_asset(
        tenant_id=tenant.id,
        class_code="STM_OUT",
        geom=_point(LON - 0.008, LAT - 0.005),
        condition=3,
    )
    _make_asset(
        tenant_id=tenant.id,
        class_code="STM_MAIN",
        geom=_line([(LON - 0.008, LAT - 0.005), (LON, LAT - 0.002), (LON + 0.005, LAT)]),
        material="HDPE",
        diameter_mm=600,
        length_m=Decimal("1680.0"),
        condition=2,
    )

    db.session.flush()

    # Look up some assets we just created so WOs/inspections can reference them
    hydrant = db.session.scalar(select(Asset).where(Asset.class_code == "WAT_HYD").limit(1))
    main = db.session.scalar(select(Asset).where(Asset.class_code == "WAT_MAIN").limit(1))
    san_mh = db.session.scalar(select(Asset).where(Asset.class_code == "SAN_MH").limit(1))
    cb = db.session.scalar(select(Asset).where(Asset.class_code == "STM_CB").limit(1))
    valve = db.session.scalar(select(Asset).where(Asset.class_code == "WAT_VLV").limit(1))
    lft = db.session.scalar(select(Asset).where(Asset.class_code == "SAN_LFT").limit(1))

    # Work order template
    template = WoTemplate(
        tenant_id=tenant.id,
        name="Hydrant flushing",
        category="flushing",
        default_priority="normal",
        applies_to_classes=["WAT_HYD"],
        task_template=[
            {"title": "Verify isolation valves", "sequence": 0},
            {"title": "Open hydrant slowly", "sequence": 1},
            {"title": "Flow until clear", "sequence": 2},
            {"title": "Close hydrant + test drainage", "sequence": 3},
        ],
        instructions="Run for at least 5 minutes or until water clears.",
    )
    db.session.add(template)
    db.session.flush()

    # Work orders — mix of statuses
    def _wo(**kwargs) -> WorkOrder:
        wo_number = next_wo_number(tenant_id=tenant.id)
        defaults = {
            "type": "reactive",
            "category": "repair",
            "priority": "normal",
            "status": "open",
            "reported_by": admin.id,
        }
        for k, v in defaults.items():
            kwargs.setdefault(k, v)
        wo = WorkOrder(tenant_id=tenant.id, wo_number=wo_number, **kwargs)
        db.session.add(wo)
        db.session.flush()
        return wo

    _wo(
        title="Investigate low pressure on Maple Ave",
        description="Multiple residents report low pressure since Tuesday.",
        category="repair",
        priority="high",
        status="in_progress",
        asset_id=main.id if main else None,
        assigned_to=tech.id,
        crew_id=crew.id,
        started_at=datetime.now(UTC) - timedelta(hours=4),
    )
    wo2 = _wo(
        title="Routine flushing — Hydrant grid A",
        category="flushing",
        priority="low",
        status="assigned",
        asset_id=hydrant.id if hydrant else None,
        assigned_to=tech.id,
        template_id=template.id,
        scheduled_for=datetime.now(UTC) + timedelta(days=2),
    )
    # Apply template tasks to wo2
    for idx, task in enumerate(template.task_template):
        db.session.add(
            WorkOrderTask(
                work_order_id=wo2.id,
                sequence=task.get("sequence", idx),
                title=task["title"],
            )
        )

    _wo(
        title="Manhole cover damaged at 5th & Bay",
        category="repair",
        priority="emergency",
        status="open",
        asset_id=san_mh.id if san_mh else None,
        due_by=datetime.now(UTC) + timedelta(hours=12),
    )
    wo4 = _wo(
        title="Catch basin cleaning — quarterly",
        category="cleaning",
        priority="normal",
        status="completed",
        asset_id=cb.id if cb else None,
        assigned_to=tech.id,
        completed_at=datetime.now(UTC) - timedelta(days=3),
        started_at=datetime.now(UTC) - timedelta(days=3, hours=2),
        resolution="Removed ~150L of sediment. Grate intact.",
    )
    db.session.add(
        WorkOrderTimeLog(
            work_order_id=wo4.id,
            user_id=tech.id,
            started_at=datetime.now(UTC) - timedelta(days=3, hours=2),
            ended_at=datetime.now(UTC) - timedelta(days=3),
            hours_decimal=Decimal("2.0"),
            notes="Sediment removal + flush",
        )
    )
    db.session.add(
        WorkOrderMaterial(
            work_order_id=wo4.id,
            description="Vac truck use",
            quantity=Decimal("1.0"),
            unit="trip",
            unit_cost=Decimal("250.00"),
        )
    )

    _wo(
        title="Lift station weekly round",
        category="inspection",
        priority="normal",
        status="draft",
        asset_id=lft.id if lft else None,
        assigned_to=tech.id,
    )
    _wo(
        title="Valve exercise — gate valves north zone",
        category="valve_exercise",
        priority="low",
        status="on_hold",
        asset_id=valve.id if valve else None,
    )

    db.session.flush()

    # Inspections — one of each non-CCTV kind
    def _ins(**kwargs) -> Inspection:
        n = next_inspection_number(tenant_id=tenant.id)
        ins = Inspection(
            tenant_id=tenant.id,
            inspection_number=n,
            performed_by=tech.id,
            performed_at=datetime.now(UTC) - timedelta(days=random.randint(1, 14)),
            **kwargs,
        )
        db.session.add(ins)
        db.session.flush()
        return ins

    if hydrant:
        _ins(
            kind="hydrant_flow",
            asset_id=hydrant.id,
            overall_condition=2,
            pass_=True,
            data={
                "static_psi": 72,
                "residual_psi": 58,
                "flow_gpm": 980,
                "pitot_psi": 32,
                "outlet_size_mm": 64,
                "coefficient": 0.9,
                "calc_gpm_at_20psi": 2018,
                "color_class": "blue",
            },
        )

    if valve:
        _ins(
            kind="valve_exercise",
            asset_id=valve.id,
            overall_condition=2,
            pass_=True,
            data={
                "turns_to_close": 24,
                "expected_turns": 24,
                "operates": True,
                "leaks": False,
                "torque_excessive": False,
                "lubricated": True,
            },
        )

    if san_mh:
        _ins(
            kind="manhole",
            asset_id=san_mh.id,
            overall_condition=3,
            pass_=True,
            data={
                "frame_cover_condition": 2,
                "chimney_condition": 3,
                "cone_condition": 2,
                "wall_condition": 3,
                "bench_channel_condition": 3,
                "infiltration_lpm": "0.0",
                "depth_m": "3.4",
                "h2s_ppm": 0,
            },
        )

    if cb:
        _ins(
            kind="catch_basin",
            asset_id=cb.id,
            overall_condition=3,
            pass_=False,
            data={
                "grate_condition": 2,
                "sump_depth_m": "0.5",
                "sediment_depth_m": "0.4",
                "needs_cleaning": True,
                "blockage": False,
            },
            notes="Sediment depth approaching threshold; schedule cleaning.",
        )

    if lft:
        _ins(
            kind="lift_station_round",
            asset_id=lft.id,
            overall_condition=2,
            pass_=True,
            data={
                "wet_well_level_m": "1.4",
                "pump1_runtime_h": "1284.3",
                "pump2_runtime_h": "1199.7",
                "pump1_amps": "12.4",
                "pump2_amps": "12.1",
                "alarms": [],
                "generator_test_pass": True,
                "odour_pass": True,
            },
        )

    # CCTV — find a sewer main; if none, skip
    san_main = db.session.scalar(select(Asset).where(Asset.class_code == "STM_MAIN").limit(1))
    if san_main:
        _ins(
            kind="cctv",
            asset_id=san_main.id,
            overall_condition=3,
            pass_=False,
            data={
                "standard": "PACP",
                "version": "7.0",
                "upstream_mh": "MH-A12",
                "downstream_mh": "MH-A13",
                "direction": "upstream",
                "length_surveyed_m": "92.0",
                "length_total_m": "92.0",
                "observations": [
                    {
                        "distance_m": "12.4",
                        "code": "CC",
                        "remarks": "circumferential crack near upstream MH",
                        "joint": False,
                        "continuous": False,
                    },
                    {
                        "distance_m": "34.7",
                        "code": "RFJ",
                        "clock_from": 10,
                        "clock_to": 2,
                        "joint": True,
                        "continuous": False,
                        "remarks": "fine roots at joint",
                    },
                    {
                        "distance_m": "58.2",
                        "code": "DSC",
                        "remarks": "coarse sediment ~10% pipe area",
                    },
                    {
                        "distance_m": "76.0",
                        "code": "FL",
                        "remarks": "longitudinal fracture",
                    },
                ],
                "ratings": {
                    "structural_qr": 4,
                    "om_qr": 2,
                    "structural_total": 28,
                    "om_total": 12,
                },
            },
            notes="Schedule structural rehab — Quick Rating 4.",
        )

    # Service requests — assorted statuses + a true duplicate pair
    def _sr(**kwargs) -> ServiceRequest:
        n = next_sr_number(tenant_id=tenant.id)
        defaults = {
            "priority": "normal",
            "status": "new",
            "reported_at": datetime.now(UTC),
            "intake_user_id": intake.id,
        }
        for k, v in defaults.items():
            kwargs.setdefault(k, v)
        sr = ServiceRequest(tenant_id=tenant.id, sr_number=n, **kwargs)
        db.session.add(sr)
        db.session.flush()
        return sr

    _sr(
        category="low_pressure",
        domain="water",
        priority="high",
        caller_name="Margaret Chen",
        caller_phone="410-555-0118",
        address="221 Bay Ridge Ave, Annapolis, MD",
        location=geojson_to_wkb(_point(-76.4885, 38.9690)),
        description="Pressure dropped sharply this afternoon — barely a trickle.",
        reported_at=datetime.now(UTC) - timedelta(hours=2),
    )
    _sr(
        category="sewer_backup",
        domain="sewer",
        priority="emergency",
        status="triaged",
        caller_name="Diego Rivera",
        caller_phone="410-555-0244",
        address="14 Greenfield Rd",
        location=geojson_to_wkb(_point(-76.4865, 38.9722)),
        description="Sewage backing up into basement utility room.",
        reported_at=datetime.now(UTC) - timedelta(hours=5),
    )
    _sr(
        category="flooding",
        domain="storm",
        caller_name="Anonymous",
        address="Corner of Forest Dr and Hilltop",
        location=geojson_to_wkb(_point(-76.4920, 38.9750)),
        description="Catch basin overflowing during yesterday's storm.",
        reported_at=datetime.now(UTC) - timedelta(days=1),
    )
    # A pair within 100m / 7d that the duplicate detector will flag together
    _sr(
        category="odour",
        domain="sewer",
        caller_name="Pat Lee",
        address="900 block, West St",
        location=geojson_to_wkb(_point(-76.4972, 38.9658)),
        description="Strong smell coming from the manhole.",
        reported_at=datetime.now(UTC) - timedelta(days=2),
    )
    _sr(
        category="odour",
        domain="sewer",
        caller_name="J. Park",
        address="908 West St",
        location=geojson_to_wkb(_point(-76.4970, 38.9659)),
        description="Same smell as yesterday — multiple neighbours noticed it.",
        reported_at=datetime.now(UTC) - timedelta(hours=18),
    )
    _sr(
        category="damaged_asset",
        domain="water",
        priority="high",
        status="closed",
        closed_at=datetime.now(UTC) - timedelta(days=1),
        closure_reason="resolved",
        closure_notes="Hydrant struck — replaced same day.",
        caller_name="Public Works dispatcher",
        address="Eastport Plaza",
        location=geojson_to_wkb(_point(-76.4825, 38.9688)),
        description="Vehicle struck a hydrant, water spraying.",
        reported_at=datetime.now(UTC) - timedelta(days=2),
    )

    db.session.commit()


def register(app: Flask) -> None:
    @app.cli.command("seed-demo")
    @click.option(
        "--force",
        is_flag=True,
        help="Wipe the existing demo tenant before seeding.",
    )
    @with_appcontext
    def seed_demo(force: bool):
        existing = db.session.scalar(
            select(Tenant)
            .where(Tenant.slug == DEMO_SLUG)
            .execution_options(skip_tenant_filter=True)
        )
        if existing and not force:
            click.echo(f"Demo tenant {DEMO_SLUG!r} already exists. Re-run with --force to wipe.")
            return
        if existing and force:
            click.echo(f"Wiping {DEMO_SLUG!r}…")
            _wipe_demo()
        _seed()
        click.echo(
            "\n".join(
                [
                    "",
                    f"Demo tenant seeded: slug={DEMO_SLUG!r} ({DEMO_NAME})",
                    f"  Admin:      {ADMIN_EMAIL}      / {ADMIN_PASSWORD}",
                    f"  Supervisor: {SUP_EMAIL} / {ADMIN_PASSWORD}",
                    f"  Tech:       {TECH_EMAIL}       / {ADMIN_PASSWORD}",
                    f"  Intake:     {INTAKE_EMAIL}     / {ADMIN_PASSWORD}",
                    "",
                    "Sign in at http://127.0.0.1:5173/login",
                    f"  slug:     {DEMO_SLUG}",
                    f"  email:    {ADMIN_EMAIL}",
                    f"  password: {ADMIN_PASSWORD}",
                ]
            )
        )
