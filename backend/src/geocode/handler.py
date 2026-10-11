"""GET /geocode?q=        → [{label, lat, lon, ward}]  (address search)
GET /geocode?lat=&lon=  → [{label, lat, lon, ward}]  (reverse: "Use my location")

Amazon Location Service if PLACE_INDEX_NAME is set, else Nominatim."""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from typing import Any

from src.common.responses import ApiError, api_handler, ok, query_param

logger = logging.getLogger()

# Bias results to Delhi NCT
DELHI_BBOX = (76.84, 28.40, 77.35, 28.89)  # west, south, east, north
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = os.environ.get("NOMINATIM_USER_AGENT", "Boond/1.0 (rainwater harvesting planner)")

_nominatim_lock = threading.Lock()
_last_nominatim_call = 0.0


def search_location_service(q: str, index_name: str) -> list[dict[str, Any]]:
    import boto3

    res = boto3.client("location").search_place_index_for_text(
        IndexName=index_name, Text=q, FilterBBox=list(DELHI_BBOX), FilterCountries=["IND"], MaxResults=5
    )
    out = []
    for r in res.get("Results", []):
        place = r["Place"]
        lon, lat = place["Geometry"]["Point"]
        out.append({
            "label": place.get("Label", q),
            "lat": lat,
            "lon": lon,
            "ward": place.get("Neighborhood") or place.get("SubMunicipality") or place.get("Municipality") or "Unassigned",
        })
    return out


def _nominatim_get(url: str, params: dict[str, Any]) -> Any:
    global _last_nominatim_call
    with _nominatim_lock:  # usage policy: max 1 request per second
        wait = 1.0 - (time.monotonic() - _last_nominatim_call)
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                return json.loads(resp.read().decode("utf-8"))
        finally:
            _last_nominatim_call = time.monotonic()


def _nominatim_row(r: dict[str, Any], fallback_label: str) -> dict[str, Any]:
    addr = r.get("address", {})
    return {
        "label": r.get("display_name", fallback_label),
        "lat": float(r["lat"]),
        "lon": float(r["lon"]),
        "ward": addr.get("suburb") or addr.get("neighbourhood") or addr.get("city_district") or "Unassigned",
    }


def search_nominatim(q: str) -> list[dict[str, Any]]:
    rows = _nominatim_get(NOMINATIM_URL, {
        "q": q, "format": "jsonv2", "addressdetails": 1, "limit": 5, "countrycodes": "in",
        "viewbox": ",".join(map(str, DELHI_BBOX)), "bounded": 1,
    })
    return [_nominatim_row(r, q) for r in rows]


def reverse_nominatim(lat: float, lon: float) -> list[dict[str, Any]]:
    row = _nominatim_get(NOMINATIM_REVERSE_URL, {"lat": lat, "lon": lon, "format": "jsonv2", "addressdetails": 1, "zoom": 18})
    if not row or "lat" not in row:
        return []
    # Keep the user's own point: the nearest address can be tens of metres away.
    return [{**_nominatim_row(row, f"{lat:.5f}, {lon:.5f}"), "lat": lat, "lon": lon}]


def reverse_location_service(lat: float, lon: float, index_name: str) -> list[dict[str, Any]]:
    import boto3

    res = boto3.client("location").search_place_index_for_position(IndexName=index_name, Position=[lon, lat], MaxResults=1)
    out = []
    for r in res.get("Results", []):
        place = r["Place"]
        out.append({
            "label": place.get("Label", f"{lat:.5f}, {lon:.5f}"),
            "lat": lat,
            "lon": lon,
            "ward": place.get("Neighborhood") or place.get("SubMunicipality") or place.get("Municipality") or "Unassigned",
        })
    return out


def in_delhi(lat: float, lon: float) -> bool:
    west, south, east, north = DELHI_BBOX
    return west <= lon <= east and south <= lat <= north


def reverse(event: dict[str, Any]) -> dict[str, Any]:
    try:
        lat, lon = float(query_param(event, "lat") or ""), float(query_param(event, "lon") or "")
    except ValueError as exc:
        raise ApiError("lat and lon must be numbers") from exc
    if not in_delhi(lat, lon):
        raise ApiError("Boond covers Delhi only for now. Search for your address instead.")
    index_name = os.environ.get("PLACE_INDEX_NAME")
    if index_name:
        try:
            return ok(reverse_location_service(lat, lon, index_name))
        except Exception:
            logger.exception("Location Service reverse geocode failed; falling back to Nominatim")
    try:
        found = reverse_nominatim(lat, lon)
    except Exception:
        logger.exception("Nominatim reverse geocode failed")
        found = []
    # Even with no address, the point itself is usable.
    return ok(found or [{"label": f"{lat:.5f}, {lon:.5f}", "lat": lat, "lon": lon, "ward": "Unassigned"}])


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if query_param(event, "lat") is not None or query_param(event, "lon") is not None:
        return reverse(event)
    q = (query_param(event, "q") or "").strip()
    if len(q) < 3:
        raise ApiError("Type at least 3 characters")
    index_name = os.environ.get("PLACE_INDEX_NAME")
    if index_name:
        try:
            return ok(search_location_service(q[:200], index_name))
        except Exception:
            logger.exception("Location Service search failed; falling back to Nominatim")
    return ok(search_nominatim(q[:200]))
