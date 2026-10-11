"""Plan create/read/update, shared by the plans API and the agent tools."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from src.calculator.handler import calculate
from src.calculator.rainfall import get_rainfall_record
from src.common import config
from src.common.db import get_store
from src.common.responses import ApiError
from src.plans.inputs import validate_inputs

DEFAULTS = {
    "ward": "Unassigned", "roofType": None, "monthlyWaterBill": 0, "tankersPerYear": 0, "roofPolygon": None,
    "buildingId": None, "contaminationSourceNearby": None, "waterloggingArea": None, "pitNearFoundation": None,
}
INTERNAL_KEYS = ("PK", "SK", "GSI1PK", "GSI1SK")
logger = logging.getLogger()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _keys(plan_id: str, ward: str, status: str) -> dict[str, str]:
    return {
        "PK": f"PLAN#{plan_id}",
        "SK": "META",
        "GSI1PK": f"WARD#{ward}",
        "GSI1SK": f"STATUS#{status}#{plan_id}",
    }


def public(item: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if k not in INTERNAL_KEYS}


def _inputs_with_defaults(inputs: dict[str, Any]) -> dict[str, Any]:
    merged = {**DEFAULTS, **inputs}
    merged["roofType"] = merged["roofType"] or config.rules()["default_roof_type"]
    return merged


def create_plan(
    body: dict[str, Any], plan_id: str | None = None, status: str = "planned", extra: dict[str, Any] | None = None
) -> dict[str, Any]:
    """plan_id/status/extra are for seeding demo data; the API only passes body."""
    rules = config.rules()
    inputs = _inputs_with_defaults(validate_inputs(body, rules))
    store = get_store()
    rainfall, source, daily = get_rainfall_record(inputs["lat"], inputs["lon"], rules, store)
    plan_id = plan_id or uuid.uuid4().hex[:12]
    now = _now()
    item = {
        **_keys(plan_id, inputs["ward"], status),
        "planId": plan_id,
        **inputs,
        **calculate(inputs, rainfall, rules, config.structures(), daily),
        "rainfallSource": source,
        "status": status,
        "createdAt": now,
        "updatedAt": now,
        **(extra or {}),
    }
    store.put(item)
    return public(item)


def load_plan(plan_id: str) -> dict[str, Any]:
    item = get_store().get(f"PLAN#{plan_id}", "META")
    if not item:
        raise ApiError("Plan not found", 404)
    return item


def get_plan(plan_id: str) -> dict[str, Any]:
    item = load_plan(plan_id)
    if "water" not in item:
        # Plans made before the day-by-day water balance existed get it the first time they are opened.
        try:
            upgraded = preview_changes(plan_id, {})
            if upgraded.get("water"):
                get_store().put(upgraded)
                item = upgraded
        except Exception:
            logger.exception("Water balance upgrade failed for %s", plan_id)
    return public(item)


def preview_changes(plan_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Recalculate with changed inputs without saving. Returns the would-be plan."""
    rules = config.rules()
    current = load_plan(plan_id)
    updates = validate_inputs(changes, rules, partial=True)
    inputs = {**{k: current.get(k) for k in (*DEFAULTS, "address", "lat", "lon", "roofAreaM2", "plotAreaM2", "residents", "openSpace")}, **updates}
    inputs = _inputs_with_defaults(inputs)

    # Daily rainfall comes from the cache (one download per location), so a recalculation stays cheap.
    rainfall, source, daily = get_rainfall_record(inputs["lat"], inputs["lon"], rules, get_store())
    if "lat" not in updates and "lon" not in updates and source == "default":
        rainfall, source = current["rainfallMm"], current.get("rainfallSource", "cache")

    return {**current, **inputs, **calculate(inputs, rainfall, rules, config.structures(), daily), "rainfallSource": source}


def update_plan(plan_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    item = preview_changes(plan_id, changes)
    item.update(_keys(plan_id, item["ward"], item["status"]))
    item["updatedAt"] = _now()
    get_store().put(item)
    return public(item)


def set_status(plan_id: str, status: str, **extra: Any) -> dict[str, Any]:
    item = load_plan(plan_id)
    item.update(extra)
    item["status"] = status
    item.update(_keys(plan_id, item["ward"], status))
    item["updatedAt"] = _now()
    get_store().put(item)
    return public(item)
