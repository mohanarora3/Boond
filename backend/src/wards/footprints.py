"""Building footprint maths shared by demo/build_footprints.py and the Wards/Dashboard Lambdas. Pure functions."""
from __future__ import annotations

import math
from typing import Any, Iterable

from src.calculator import sizing

EARTH_RADIUS_M = 6371008.8  # mean Earth radius, as @turf/area v7 uses, so backend and frontend areas agree


def _ring_area_m2(ring: list[list[float]]) -> float:
    """Spherical area of a lon/lat ring (Chamberlain & Duquette), the algorithm @turf/area uses."""
    n = len(ring)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        lon1, lat1 = ring[i][0], ring[i][1]
        lon2, lat2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        total += math.radians(lon2 - lon1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2)


def geodesic_area_m2(geometry: dict[str, Any]) -> float:
    """Area of a GeoJSON Polygon or MultiPolygon in m² (outer rings minus holes)."""
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    return sum(_ring_area_m2(p[0]) - sum(_ring_area_m2(h) for h in p[1:]) for p in polygons)


def mandatory_label(area_m2: float, rules: dict[str, Any]) -> str:
    """A plot is always at least as big as the building on it, so a big enough footprint means harvesting is required.
    A smaller one *may* still sit on a plot over the threshold."""
    return "required" if area_m2 >= rules["mandatory_min_plot_m2"] else "maybe"


def passes_confidence(sources: Iterable[dict[str, Any]] | None, minimum: float) -> bool:
    """Keep a building unless its only confidence scores are below the minimum (OSM / Microsoft carry none)."""
    scores = [s["confidence"] for s in (sources or []) if s.get("confidence") is not None]
    return not scores or max(scores) >= minimum


def building_properties(
    building_id: str, geometry: dict[str, Any], rainfall_mm: float, rules: dict[str, Any], cfg: dict[str, Any]
) -> dict[str, Any] | None:
    """Properties for one footprint, or None if it is too small to count."""
    area = geodesic_area_m2(geometry)
    if area < cfg["min_area_m2"]:
        return None
    coefficient = sizing.runoff_coefficient(cfg["default_roof_type"], rules)
    return {
        "buildingId": building_id,
        "areaM2": round(area, 1),
        "litresPerYear": round(sizing.litres_per_year(area, rainfall_mm, coefficient)),
        "mandatory": mandatory_label(area, rules),
    }


def round_coords(value: Any, places: int = 6) -> Any:
    if isinstance(value, float):
        return round(value, places)
    if isinstance(value, list):
        return [round_coords(v, places) for v in value]
    return value


def summarise(features: list[dict[str, Any]]) -> dict[str, Any]:
    """Ward totals; always equal to the sum over the features."""
    props = [f["properties"] for f in features]
    return {
        "buildingCount": len(props),
        "requiredCount": sum(1 for p in props if p["mandatory"] == "required"),
        "totalLitresPerYear": sum(p["litresPerYear"] for p in props),
        "totalRoofAreaM2": round(sum(p["areaM2"] for p in props), 1),
    }


def bucket_index(litres: float, buckets: list[float]) -> int:
    """0..len(buckets): which colour bucket a building's litres/year fall into."""
    return sum(1 for edge in buckets if litres >= edge)
