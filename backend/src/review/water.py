"""Where a harvesting system's water can go: real water bodies and drains near the house, from OpenStreetMap (Overpass API).

Results are cached in the table per ~100 m cell for a week, so an officer opening the same application twice
(or neighbouring houses) does not hit Overpass again. If Overpass is down, the officer still gets the on-site options.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from src.common.db import get_store
from src.common.geo import haversine_m

logger = logging.getLogger()

OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
USER_AGENT = "Boond/1.0 (rainwater harvesting planner)"
WATER_RADIUS_M = 2000   # ponds, lakes, reservoirs a tanker or pipe could reasonably reach
DRAIN_RADIUS_M = 600    # storm drains / canals the overflow can be piped into
CACHE_DAYS = 7
MAX_RESULTS = 12

BODY_KINDS = {"pond", "lake", "reservoir", "basin", "lagoon", "oxbow", "wastewater"}
LINE_KINDS = {"drain", "canal", "ditch", "stream", "river"}


def overpass_query(lat: float, lon: float) -> str:
    return f"""[out:json][timeout:20];
(
  nwr(around:{WATER_RADIUS_M},{lat},{lon})["natural"="water"];
  nwr(around:{WATER_RADIUS_M},{lat},{lon})["landuse"="reservoir"];
  nwr(around:{WATER_RADIUS_M},{lat},{lon})["landuse"="basin"];
  way(around:{DRAIN_RADIUS_M},{lat},{lon})["waterway"~"^(drain|canal|ditch|stream|river)$"];
);
out center tags;"""


def fetch_overpass(lat: float, lon: float) -> dict[str, Any]:
    data = urllib.parse.urlencode({"data": overpass_query(lat, lon)}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _kind(tags: dict[str, str]) -> str | None:
    if tags.get("waterway") in LINE_KINDS:
        return tags["waterway"]
    if tags.get("landuse") in ("reservoir", "basin"):
        return tags["landuse"]
    if tags.get("natural") == "water":
        water = tags.get("water", "")
        if water == "wastewater":
            return None  # sewage treatment ponds are not a destination for clean rainwater
        return water if water in BODY_KINDS else "water"
    return None


def parse_elements(raw: dict[str, Any], lat: float, lon: float) -> list[dict[str, Any]]:
    """Overpass elements → [{osmId, name, kind, category, lat, lon, distanceM}], nearest first, deduplicated."""
    out: dict[str, dict[str, Any]] = {}
    for el in raw.get("elements", []):
        tags = el.get("tags") or {}
        kind = _kind(tags)
        if not kind:
            continue
        point = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
        if not point:
            continue
        osm_id = f"{el['type']}/{el['id']}"
        name = tags.get("name:en") or tags.get("name")
        out[osm_id] = {
            "osmId": osm_id,
            "name": name,
            "kind": kind,
            "category": "channel" if kind in LINE_KINDS else "water_body",
            "lat": round(point["lat"], 6),
            "lon": round(point["lon"], 6),
            "distanceM": round(haversine_m(lat, lon, point["lat"], point["lon"])),
        }
    rows = sorted(out.values(), key=lambda r: r["distanceM"])
    bodies = [r for r in rows if r["category"] == "water_body"][:MAX_RESULTS]
    channels = [r for r in rows if r["category"] == "channel"][:MAX_RESULTS]
    return bodies + channels


def _cache_key(lat: float, lon: float) -> str:
    return f"WATER#{lat:.3f},{lon:.3f}"


def nearby_water(lat: float, lon: float, fetch: Callable[[float, float], dict[str, Any]] | None = None,
                 now: datetime | None = None) -> dict[str, Any]:
    """{available, stale, fetchedAt, source, features}. Never raises for a network failure."""
    now = now or datetime.now(timezone.utc)
    store = get_store()
    key = _cache_key(lat, lon)
    cached = store.get(key, "META")
    if cached and now - datetime.fromisoformat(cached["fetchedAt"]) < timedelta(days=CACHE_DAYS):
        return {"available": True, "stale": False, "fetchedAt": cached["fetchedAt"], "source": "OpenStreetMap",
                "features": _with_distance(cached["features"], lat, lon)}
    try:
        raw = (fetch or fetch_overpass)(lat, lon)
    except Exception:
        logger.exception("Overpass lookup failed")
        if cached:
            return {"available": True, "stale": True, "fetchedAt": cached["fetchedAt"], "source": "OpenStreetMap",
                    "features": _with_distance(cached["features"], lat, lon)}
        return {"available": False, "stale": True, "fetchedAt": None, "source": "OpenStreetMap", "features": []}
    features = parse_elements(raw, lat, lon)
    fetched = now.isoformat(timespec="seconds")
    store.put({"PK": key, "SK": "META", "fetchedAt": fetched, "features": features})
    return {"available": True, "stale": False, "fetchedAt": fetched, "source": "OpenStreetMap", "features": features}


def _with_distance(features: list[dict[str, Any]], lat: float, lon: float) -> list[dict[str, Any]]:
    """Cache cells are ~100 m, so recompute distances for this exact house."""
    rows = [{**f, "distanceM": round(haversine_m(lat, lon, f["lat"], f["lon"]))} for f in features]
    return sorted(rows, key=lambda r: (r["category"] != "water_body", r["distanceM"]))


def suggest_destination(plan: dict[str, Any], features: list[dict[str, Any]]) -> dict[str, Any]:
    """A starting point for the officer, from the plan's own site answers and the real map — never auto-applied."""
    s = plan["structure"]
    reasons = (plan.get("feasibility") or {}).get("reasons", [])
    body = next((f for f in features if f["category"] == "water_body"), None)
    drain = next((f for f in features if f["category"] == "channel"), None)
    if s["type"] in ("recharge_pit", "recharge_trench"):
        return {"type": "onsite_recharge", "why": "open_ground_safe"}
    if s.get("rechargeRuledOut") and body:
        return {"type": "water_body", "osmId": body["osmId"], "name": body["name"], "kind": body["kind"],
                "distanceM": body["distanceM"], "why": "recharge_unsafe_" + (reasons[0] if reasons else "site")}
    if body and body["distanceM"] <= 1000:
        return {"type": "water_body", "osmId": body["osmId"], "name": body["name"], "kind": body["kind"],
                "distanceM": body["distanceM"], "why": "overflow_to_nearby_body"}
    if drain:
        return {"type": "storm_drain", "osmId": drain["osmId"], "name": drain["name"], "kind": drain["kind"],
                "distanceM": drain["distanceM"], "why": "overflow_to_drain"}
    return {"type": "storage_reuse", "why": "no_open_ground"}
