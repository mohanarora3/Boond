"""Ward potential map data.

GET /wards                       → wards with summary figures
GET /wards/{ward}                → summary + 15-minute download URL for the buildings file
GET /wards/{ward}/simulate?date= → monsoon simulation (M12)
"""
from __future__ import annotations

import json
from typing import Any

from src.common import config, s3
from src.common.responses import ApiError, api_handler, method, ok, path_param

PREFIX = "public-data/wards"
MAX_JSON_BYTES = 5_000_000


def read_json(key: str) -> Any:
    raw = s3.get_bytes(key, MAX_JSON_BYTES)
    return json.loads(raw) if raw else None


def list_wards() -> list[dict[str, Any]]:
    return read_json(f"{PREFIX}/wards.json") or []


def ward_summary(slug: str) -> dict[str, Any]:
    if not slug.replace("-", "").isalnum():
        raise ApiError("Ward not found", 404)
    summary = read_json(f"{PREFIX}/{slug}/summary.json")
    if not summary:
        raise ApiError("Ward not found", 404)
    return summary


def display_config() -> dict[str, Any]:
    cfg = config.structures()["footprints"]
    return {
        "colourBuckets": cfg["colour_buckets_litres"],
        "polygonsMinZoom": cfg["polygons_min_zoom"],
        "nearestBuildingMaxM": cfg["nearest_building_max_m"],
        "dailyCycles": config.structures()["simulation"]["daily_cycles"],
    }


def ward_detail(slug: str) -> dict[str, Any]:
    summary = ward_summary(slug)
    return {**summary, **display_config(), "buildingsUrl": s3.presign_get(f"{PREFIX}/{slug}/buildings.geojson.gz")}


def load_buildings(slug: str) -> list[dict[str, Any]]:
    import gzip

    raw = s3.get_bytes(f"{PREFIX}/{slug}/buildings.geojson.gz", 200_000_000)
    if not raw:
        raise ApiError("Ward not found", 404)
    return json.loads(gzip.decompress(raw))["features"]


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if method(event) != "GET":
        raise ApiError("Not found", 404)
    slug = path_param(event, "ward")
    path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path", "")
    if not slug:
        return ok(list_wards())
    if path.endswith("/simulate"):
        from src.wards.simulate import simulate_handler

        return simulate_handler(event, slug)
    return ok(ward_detail(slug))
