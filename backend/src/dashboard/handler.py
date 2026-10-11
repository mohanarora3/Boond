"""Ward dashboard.

GET /dashboard?ward=            per-ward counts by status, litres, compliance score; map points for one ward
GET /dashboard/attention?ward=  systems that need attention, longest-open first
GET /dashboard/gap?ward=        required buildings with/without a plan (needs the ward's footprint file)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.common.db import get_store
from src.common.responses import ApiError, api_handler, ok, query_param
from src.dashboard.officer import attention_rows, compliance_gap, ward_plans

STATUSES = ("planned", "applied", "installed", "verified", "needs_attention")
HARVESTING = ("installed", "verified", "needs_attention")  # built systems
MAX_POINTS = 1000


DESTINATIONS = ("onsite_recharge", "water_body", "storm_drain", "storage_reuse")


def applications_summary(plans: list[dict[str, Any]]) -> dict[str, Any]:
    """Real filed applications (not demo seeds) and what the ward officer decided, with where approved water goes."""
    from src.review.handler import is_filed

    out: dict[str, Any] = {"filed": 0, "awaiting": 0, "approved": 0, "siteVisit": 0, "rejected": 0, "approvedLitres": 0,
                           "destinations": {d: {"plans": 0, "litres": 0} for d in DESTINATIONS}}
    for p in plans:
        if not is_filed(p):
            continue
        out["filed"] += 1
        review = p.get("review")
        if not review:
            out["awaiting"] += 1
            continue
        decision = review["decision"]
        if decision == "site_visit":
            out["siteVisit"] += 1
        elif decision == "rejected":
            out["rejected"] += 1
        elif decision == "approved":
            out["approved"] += 1
            out["approvedLitres"] += p["litresPerYear"]
            dest = (review.get("destination") or {}).get("type")
            if dest in out["destinations"]:
                out["destinations"][dest]["plans"] += 1
                out["destinations"][dest]["litres"] += p["litresPerYear"]
    return out


def summarise(plans: list[dict[str, Any]]) -> dict[str, Any]:
    by_status = {s: 0 for s in STATUSES}
    for p in plans:
        by_status[p["status"]] = by_status.get(p["status"], 0) + 1
    return {
        "applications": applications_summary(plans),
        "total": len(plans),
        "byStatus": by_status,
        "potentialLitres": sum(p["litresPerYear"] for p in plans),
        "harvestingLitres": sum(p["litresPerYear"] for p in plans if p["status"] in HARVESTING),
        "verifiedLitres": sum(p["litresPerYear"] for p in plans if p["status"] == "verified"),
    }


def build_dashboard(plans: list[dict[str, Any]], ward: str | None) -> dict[str, Any]:
    wards: dict[str, list[dict[str, Any]]] = {}
    for p in plans:
        wards.setdefault(p.get("ward") or "Unassigned", []).append(p)
    ward_rows = sorted(({"ward": w, **summarise(ps)} for w, ps in wards.items()), key=lambda r: (-r["total"], r["ward"]))
    selected = wards.get(ward, []) if ward else plans
    return {
        "wards": ward_rows,
        "selected": {"ward": ward, **summarise(selected)},
        "points": [
            {"planId": p["planId"], "lat": p["lat"], "lon": p["lon"], "status": p["status"], "litresPerYear": p["litresPerYear"],
             "review": (p.get("review") or {}).get("decision"), "filed": bool(p.get("applicationKey")) and not p.get("seeded")}
            for p in selected[:MAX_POINTS]
        ],
    }


def visible(plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from src.common import config

    hidden = set(config.structures().get("dashboard", {}).get("hidden_wards", []))
    return [p for p in plans if p.get("ward") not in hidden]


def ward_slugs() -> dict[str, dict[str, Any]]:
    """Footprint-backed wards by display name ({} if footprints haven't been built)."""
    from src.wards.handler import list_wards

    try:
        return {w["ward"]: w for w in list_wards()}
    except Exception:
        return {}


def with_compliance(data: dict[str, Any], plans: list[dict[str, Any]]) -> dict[str, Any]:
    """Compliance score per ward = verified plans on required buildings ÷ required buildings."""
    from src.wards.handler import load_buildings

    footprint_wards = ward_slugs()
    for row in data["wards"]:
        info = footprint_wards.get(row["ward"])
        if not info:
            row["requiredBuildings"], row["complianceScore"], row["slug"] = None, None, None
            continue
        required_ids = {f["properties"]["buildingId"] for f in load_buildings(info["slug"]) if f["properties"]["mandatory"] == "required"}
        verified = sum(1 for p in plans if p.get("ward") == row["ward"] and p["status"] == "verified" and p.get("buildingId") in required_ids)
        row["requiredBuildings"] = len(required_ids)
        row["complianceScore"] = round(verified / len(required_ids), 4) if required_ids else None
        row["slug"] = info["slug"]
    return data


def last_checks(plans: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    store = get_store()
    out = {}
    for p in plans:
        checks = [c for c in store.query(f"PLAN#{p['planId']}", "CHECK#") if not c.get("retake")]
        if checks:
            out[p["planId"]] = checks[-1]
    return out


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    ward = (query_param(event, "ward") or "").strip() or None
    path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path", "")
    store = get_store()

    if path.endswith("/attention"):
        plans = [p for p in visible(ward_plans(store, ward)) if p["status"] == "needs_attention"]
        return ok({"ward": ward, "rows": attention_rows(plans, last_checks(plans), datetime.now(timezone.utc))})

    if path.endswith("/gap"):
        if not ward:
            raise ApiError("Choose a ward")
        info = ward_slugs().get(ward)
        if not info:
            raise ApiError("The building map for this ward hasn't been prepared yet.", 404)
        from src.wards.handler import load_buildings

        return ok({"ward": ward, "slug": info["slug"], **compliance_gap(load_buildings(info["slug"]), ward_plans(store, ward))})

    plans = visible(store.scan_plans())
    return ok(with_compliance(build_dashboard(plans, ward), plans))
