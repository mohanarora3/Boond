"""Simulate monsoon: replay one real heavy-rain day over a ward's rooftops.

Per building: runoff = roof area × day's rain × runoff coefficient.
- plan installed / verified  → captured = min(runoff, capacity × daily_cycles); the rest overflows to drains
- plan needs_attention       → all lost (broken system)
- no plan / planned / applied → all lost to drains
"If every required building harvested" = what required buildings would capture with a standard pit of their size.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Callable

from src.calculator import sizing
from src.common import config
from src.common.db import Store, get_store
from src.common.responses import ApiError, ok, query_param

logger = logging.getLogger()

CAPTURING = ("installed", "verified")
BROKEN = ("needs_attention",)
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def fetch_day_mm(lat: float, lon: float, day: str, timeout_s: float = 10.0) -> float:
    params = urllib.parse.urlencode({
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "start_date": day, "end_date": day,
        "daily": "precipitation_sum", "timezone": "Asia/Kolkata",
    })
    req = urllib.request.Request(f"{ARCHIVE_URL}?{params}", headers={"User-Agent": "Boond/1.0"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        value = json.loads(resp.read().decode("utf-8"))["daily"]["precipitation_sum"][0]
    if value is None:
        raise ValueError("no rainfall recorded for that day")
    return float(value)


def day_rainfall_mm(lat: float, lon: float, day: str, store: Store | None, fetch: Callable[..., float] | None = None) -> float:
    """Cached per (rounded location, date): RAIN_DAY#<lat2>,<lon2>#<date>."""
    key = f"RAIN_DAY#{lat:.2f},{lon:.2f}#{day}"
    if store is not None:
        cached = store.get(key, "META")
        if cached and cached.get("mm") is not None:
            return float(cached["mm"])
    try:
        mm = (fetch or fetch_day_mm)(lat, lon, day)
    except Exception as exc:
        logger.exception("Day rainfall fetch failed")
        raise ApiError("Couldn't get rainfall for that day. Please try again.", 503) from exc
    if store is not None:
        store.put({"PK": key, "SK": "META", "mm": mm, "fetchedAt": datetime.now(timezone.utc).isoformat()})
    return mm


def standard_capacity_litres(area_m2: float, coefficient: float, structures: dict[str, Any]) -> float:
    """Capacity of the pit/trench Boond would recommend for a roof (assumes open ground and 4 residents)."""
    return sizing.recommend_structure(area_m2, coefficient, 4, True, structures)["capacityLitres"]


def simulate(
    features: list[dict[str, Any]],
    plans_by_building: dict[str, dict[str, Any]],
    rain_mm: float,
    rules: dict[str, Any],
    structures: dict[str, Any],
) -> dict[str, Any]:
    cycles = structures["simulation"]["daily_cycles"]
    default_coeff = sizing.runoff_coefficient(structures["footprints"]["default_roof_type"], rules)
    totals = {"captured": 0.0, "lostToDrains": 0.0, "lostBroken": 0.0}
    per_plan: list[dict[str, Any]] = []
    rest = {"buildings": 0, "runoff": 0.0}
    if_all_required = 0.0

    for f in features:
        p = f["properties"]
        plan = plans_by_building.get(p["buildingId"])
        if plan:
            area, coeff = plan["roofAreaM2"], plan.get("runoffCoefficient", default_coeff)
        else:
            area, coeff = p["areaM2"], default_coeff
        runoff = area * rain_mm * coeff

        if plan and plan["status"] in CAPTURING:
            captured = min(runoff, plan["structure"]["capacityLitres"] * cycles)
            outcome, lost = "captured", runoff - captured
            totals["captured"] += captured
            totals["lostToDrains"] += lost
        elif plan and plan["status"] in BROKEN:
            captured, lost, outcome = 0.0, runoff, "broken"
            totals["lostBroken"] += runoff
        else:
            captured, lost, outcome = 0.0, runoff, "lost"
            totals["lostToDrains"] += runoff

        if plan:
            per_plan.append({
                "planId": plan["planId"], "buildingId": p["buildingId"], "status": plan["status"], "outcome": outcome,
                "runoff": round(runoff), "captured": round(captured), "lost": round(lost),
            })
        else:
            rest["buildings"] += 1
            rest["runoff"] += runoff

        if p["mandatory"] == "required":
            potential = min(runoff, standard_capacity_litres(area, coeff, structures) * cycles)
            if_all_required += max(potential, captured)
        else:
            if_all_required += captured

    return {
        "rainMm": rain_mm,
        "totals": {k: round(v) for k, v in totals.items()},
        "totalRunoff": round(sum(totals.values())),
        "ifAllRequiredHarvested": round(if_all_required),
        "plans": per_plan,
        "otherBuildings": {"buildings": rest["buildings"], "runoff": round(rest["runoff"])},
    }


def ward_plans_by_building(ward_name: str, store: Store) -> dict[str, dict[str, Any]]:
    return {p["buildingId"]: p for p in store.query_gsi1(f"WARD#{ward_name}") if p.get("SK") == "META" and p.get("buildingId")}


def simulate_handler(event: dict[str, Any], slug: str) -> dict[str, Any]:
    from src.wards.handler import load_buildings, ward_summary

    structures = config.structures()
    day = (query_param(event, "date") or structures["simulation"]["default_storm_date"]).strip()
    if not DATE_RE.match(day):
        raise ApiError("date must be YYYY-MM-DD")
    try:
        if date.fromisoformat(day) >= date.today():
            raise ApiError("Pick a past date")
    except ValueError as exc:
        raise ApiError("date must be a real date") from exc

    summary = ward_summary(slug)
    store = get_store()
    lon, lat = summary["centroid"]
    rain = day_rainfall_mm(lat, lon, day, store)
    result = simulate(load_buildings(slug), ward_plans_by_building(summary["ward"], store), rain, config.rules(), structures)
    return ok({"ward": summary["ward"], "slug": slug, "date": day, **result})
