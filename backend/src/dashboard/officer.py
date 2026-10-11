"""Officer tools: what needs attention, and which required buildings still have no working system."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.common.db import Store

LINKED_STATUSES = ("planned", "applied", "installed", "verified", "needs_attention")


def ward_plans(store: Store, ward: str | None) -> list[dict[str, Any]]:
    """Per-ward reads use GSI1; the all-wards view scans (fine at city-pilot scale)."""
    if ward:
        return [p for p in store.query_gsi1(f"WARD#{ward}") if p.get("SK") == "META"]
    return store.scan_plans()


def days_between(start_iso: str | None, now: datetime) -> int | None:
    if not start_iso:
        return None
    start = datetime.fromisoformat(start_iso)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    return max(0, (now - start).days)


def attention_rows(plans: list[dict[str, Any]], last_checks: dict[str, dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """needs_attention plans, the longest-open problem first."""
    rows = []
    for p in plans:
        if p["status"] != "needs_attention":
            continue
        check = last_checks.get(p["planId"]) or {}
        since = p.get("attentionSince") or p.get("lastCheckAt") or check.get("at")
        rows.append({
            "planId": p["planId"],
            "ward": p.get("ward"),
            "structure": p["structure"]["type"],
            "lastVerdict": check.get("verdict"),
            "lastComponent": check.get("component"),
            "lastCheckAt": p.get("lastCheckAt") or check.get("at"),
            "daysOpen": days_between(since, now),
        })
    return sorted(rows, key=lambda r: (-(r["daysOpen"] or 0), r["planId"]))


def compliance_gap(features: list[dict[str, Any]], plans: list[dict[str, Any]]) -> dict[str, Any]:
    """Required buildings split into those with a plan (by status) and those without one."""
    required = {f["properties"]["buildingId"]: f for f in features if f["properties"]["mandatory"] == "required"}
    linked = {p["buildingId"]: p for p in plans if p.get("buildingId") in required}
    by_status = {s: 0 for s in LINKED_STATUSES}
    points = []
    for building_id, plan in linked.items():
        by_status[plan["status"]] = by_status.get(plan["status"], 0) + 1
        lon, lat = required[building_id]["properties"]["centroid"]
        points.append({"lon": lon, "lat": lat, "status": plan["status"], "planId": plan["planId"]})
    no_plan = [f["properties"]["centroid"] for bid, f in required.items() if bid not in linked]
    verified = by_status["verified"]
    return {
        "required": len(required),
        "withPlan": len(linked),
        "withoutPlan": len(no_plan),
        "byStatus": by_status,
        "verified": verified,
        "complianceScore": round(verified / len(required), 4) if required else None,
        "withoutPlanPoints": no_plan,
        "planPoints": points,
    }
