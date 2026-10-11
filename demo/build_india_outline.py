"""Rebuild frontend/src/assets/india_outline.json (the opening-screen outline of India).

Source: Natural Earth 1:10m admin-0 countries, *India point of view*
(ne_10m_admin_0_countries_ind, public domain). It shows India's boundary as India
officially depicts it: all of Jammu & Kashmir and Ladakh (including Gilgit-Baltistan
and Aksai Chin) and all of Arunachal Pradesh. Do NOT swap in a default world file.

    pip install shapely && python demo/build_india_outline.py
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from shapely import set_precision
from shapely.geometry import MultiPolygon, Point, mapping, shape

SRC = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson"
OUT = Path(__file__).resolve().parents[1] / "frontend" / "src" / "assets" / "india_outline.json"

# Points that must be inside (True) or outside (False) the outline.
CHECKS = {
    "Gilgit": ((74.31, 35.92), True), "Muzaffarabad": ((73.47, 34.37), True), "Aksai Chin": ((79.3, 35.2), True),
    "Shaksgam": ((76.5, 36.0), True), "Siachen": ((77.1, 35.4), True), "Tawang": ((91.86, 27.59), True),
    "Port Blair": ((92.73, 11.62), True), "Delhi": ((77.21, 28.61), True),
    "Lahore": ((74.34, 31.55), False), "Kathmandu": ((85.32, 27.71), False),
}


def main() -> None:
    with urllib.request.urlopen(SRC, timeout=120) as resp:
        data = json.load(resp)
    india = shape(next(f for f in data["features"] if f["properties"]["ADM0_A3"] == "IND")["geometry"])
    parts = []
    for p in india.geoms:  # keep every island; simplify small ones less
        s = p.simplify(0.005 if p.area < 0.05 else 0.03, preserve_topology=True)
        parts.append(p.convex_hull if s.is_empty or s.area == 0 else s)
    outline = set_precision(MultiPolygon(parts), 0.001)
    for name, ((x, y), inside) in CHECKS.items():
        assert outline.contains(Point(x, y)) == inside, f"boundary check failed: {name}"
    OUT.write_text(json.dumps({
        "type": "Feature",
        "properties": {"name": "India", "source": "Natural Earth 1:10m admin-0 countries, India point of view (ne_10m_admin_0_countries_ind). Public domain."},
        "geometry": mapping(outline),
    }, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(outline.geoms)} polygons); all boundary checks passed")


if __name__ == "__main__":
    main()
