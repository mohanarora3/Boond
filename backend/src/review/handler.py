"""Ward officer review of filed applications.

GET  /officer/applications?ward=   filed applications (real ones only — seeded demo plans are left out), awaiting first
GET  /plans/{id}/nearby-water      ponds, lakes, reservoirs and drains near the house (OpenStreetMap) + a suggested destination
POST /plans/{id}/review            {decision, destination, note} — the officer's decision, shown to the homeowner
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from src.common import s3
from src.common.db import get_store
from src.common.responses import ApiError, api_handler, json_body, method, ok, path_param, query_param
from src.plans import service
from src.review import water

DECISIONS = ("approved", "site_visit", "rejected")
DESTINATIONS = ("onsite_recharge", "water_body", "storm_drain", "storage_reuse")
NEEDS_FEATURE = ("water_body", "storm_drain")
MAX_NOTE = 600
_KEY_TIME = re.compile(r"(\d{8}T\d{6})\.pdf$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def applied_at(plan: dict[str, Any]) -> str | None:
    """When the application was filed: stored since this feature, else read from the PDF's timestamped key."""
    if plan.get("appliedAt"):
        return plan["appliedAt"]
    match = _KEY_TIME.search(plan.get("applicationKey") or "")
    if match:
        return datetime.strptime(match.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).isoformat(timespec="seconds")
    return None


def is_filed(plan: dict[str, Any]) -> bool:
    return bool(plan.get("applicationKey")) and not plan.get("seeded")


def application_row(plan: dict[str, Any]) -> dict[str, Any]:
    s = plan["structure"]
    return {
        "planId": plan["planId"],
        "address": plan["address"],
        "ward": plan.get("ward"),
        "lat": plan["lat"],
        "lon": plan["lon"],
        "roofPolygon": plan.get("roofPolygon"),
        "status": plan["status"],
        "appliedAt": applied_at(plan),
        "roofAreaM2": plan["roofAreaM2"],
        "plotAreaM2": plan["plotAreaM2"],
        "residents": plan["residents"],
        "openSpace": plan["openSpace"],
        "litresPerYear": plan["litresPerYear"],
        "mandatory": plan["mandatory"],
        "structure": {"type": s["type"], "count": s["count"], "dimensions": s["dimensions"],
                      "capacityLitres": s["capacityLitres"], "rechargeRuledOut": s.get("rechargeRuledOut", False)},
        "feasibility": plan.get("feasibility") or {"reasons": [], "warnings": []},
        "netCostInr": plan["money"]["netCostInr"],
        "applicationUrl": s3.presign_get(plan["applicationKey"], f"boond-application-{plan['planId']}.pdf"),
        "review": plan.get("review"),
    }


def list_applications(ward: str | None) -> dict[str, Any]:
    plans = [p for p in get_store().scan_plans() if is_filed(p)]
    wards: dict[str, dict[str, int]] = {}
    for p in plans:
        w = wards.setdefault(p.get("ward") or "Unassigned", {"total": 0, "awaiting": 0})
        w["total"] += 1
        w["awaiting"] += 0 if p.get("review") else 1
    selected = [p for p in plans if not ward or p.get("ward") == ward]
    rows = [application_row(p) for p in selected]
    rows.sort(key=lambda r: r["appliedAt"] or "", reverse=True)
    rows.sort(key=lambda r: r["review"] is not None)  # awaiting first, newest first within each group
    return {
        "ward": ward,
        "wards": [{"ward": w, **c} for w, c in sorted(wards.items(), key=lambda kv: (-kv[1]["awaiting"], kv[0]))],
        "rows": rows,
    }


def nearby(plan_id: str) -> dict[str, Any]:
    plan = service.load_plan(plan_id)
    found = water.nearby_water(plan["lat"], plan["lon"])
    return {**found, "suggestion": water.suggest_destination(plan, found["features"])}


def _destination(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("type") not in DESTINATIONS:
        raise ApiError(f"destination.type must be one of: {', '.join(DESTINATIONS)}")
    out: dict[str, Any] = {"type": raw["type"]}
    if raw["type"] in NEEDS_FEATURE:
        osm_id = raw.get("osmId")
        if not isinstance(osm_id, str) or not re.fullmatch(r"(node|way|relation)/\d{1,15}", osm_id):
            raise ApiError("Choose the water body or drain on the map")
        out["osmId"] = osm_id
        name = raw.get("name")
        out["name"] = str(name).strip()[:120] if name else None
        kind = raw.get("kind")
        out["kind"] = str(kind)[:30] if kind else None
        dist = raw.get("distanceM")
        if dist is not None:
            if isinstance(dist, bool) or not isinstance(dist, (int, float)) or not 0 <= dist <= 50_000:
                raise ApiError("destination.distanceM must be a distance in metres")
            out["distanceM"] = round(dist)
        else:
            out["distanceM"] = None
    return out


def review_application(plan_id: str, body: dict[str, Any]) -> dict[str, Any]:
    plan = service.load_plan(plan_id)
    if not is_filed(plan):
        raise ApiError("This plan has no filed application to review", 409)
    decision = body.get("decision")
    if decision not in DECISIONS:
        raise ApiError(f"decision must be one of: {', '.join(DECISIONS)}")
    note = body.get("note") or ""
    if not isinstance(note, str):
        raise ApiError("note must be text")
    note = note.strip()[:MAX_NOTE]
    if decision in ("rejected", "site_visit") and not note:
        raise ApiError("Add a note so the homeowner knows why")
    destination = _destination(body.get("destination")) if decision == "approved" else (
        _destination(body["destination"]) if body.get("destination") else None)

    review = {"decision": decision, "destination": destination, "note": note or None, "decidedAt": _now()}
    history = [*(plan.get("reviewHistory") or []), review]
    extra = {"review": review, "reviewHistory": history[-20:]}
    if not plan.get("appliedAt"):
        extra["appliedAt"] = applied_at(plan)
    return service.set_status(plan_id, plan["status"], **extra)


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    verb = method(event)
    plan_id = path_param(event, "id")
    path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path", "")

    if verb == "GET" and path.rstrip("/").endswith("/officer/applications"):
        return ok(list_applications((query_param(event, "ward") or "").strip() or None))
    if verb == "GET" and plan_id and path.endswith("/nearby-water"):
        return ok(nearby(plan_id))
    if verb == "POST" and plan_id and path.endswith("/review"):
        return ok(review_application(plan_id, json_body(event)))
    raise ApiError("Not found", 404)
