"""Build per-ward building footprint files for the ward potential map.

    python demo/fetch_overture.py                         # once: download Overture buildings for the demo wards
    python demo/build_footprints.py --local               # → backend/.local/public-data/wards/<slug>/
    python demo/build_footprints.py --upload --bucket B   # → s3://B/public-data/wards/<slug>/

For each building whose centroid is inside a demo ward: geodesic area, required/maybe, litres per year
(ward rainfall × default roof type), simplified geometry. Outputs buildings.geojson.gz, summary.json per
ward, and wards.json (the index).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DATA = ROOT / "demo" / "data"
sys.path.insert(0, str(BACKEND))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--local", action="store_true")
    target.add_argument("--upload", action="store_true")
    parser.add_argument("--bucket")
    args = parser.parse_args()
    if args.upload and not args.bucket:
        parser.error("--upload needs --bucket")
    if args.local:
        os.environ.setdefault("BOOND_LOCAL_DB", str(BACKEND / ".local" / "db.json"))

    import duckdb
    from shapely import wkb
    from shapely.geometry import mapping, shape
    from shapely.prepared import prep

    from src.calculator.rainfall import get_annual_rainfall
    from src.common import config
    from src.common.db import get_store
    from src.wards import footprints as fp

    rules, cfg = config.rules(), config.structures()["footprints"]
    store = get_store() if args.local else None
    ward_shapes = {f["properties"]["Ward_No"]: shape(f["geometry"]) for f in json.loads((DATA / "delhi_wards.geojson").read_text())["features"]}
    rows = duckdb.connect().execute(f"SELECT id, wkb, sources FROM read_parquet('{DATA / 'overture_buildings.parquet'}')").fetchall()
    release = (DATA / "overture_release.txt").read_text().strip()
    tolerance_deg = cfg["simplify_tolerance_m"] / 111_320
    print(f"{len(rows)} Overture buildings in cache (release {release})")

    buildings = []
    for building_id, raw, sources in rows:
        if not fp.passes_confidence(sources, cfg["confidence_min"]):
            continue
        geom = wkb.loads(bytes(raw))
        if geom.geom_type in ("Polygon", "MultiPolygon"):
            buildings.append((building_id, geom, geom.centroid))

    index = []
    for ward in cfg["wards"]:
        boundary = ward_shapes[ward["wardNo"]]
        inside = prep(boundary)
        centre = boundary.representative_point()
        rainfall, rain_source = get_annual_rainfall(centre.y, centre.x, rules, store)
        features = []
        for building_id, geom, centroid in buildings:
            if not inside.contains(centroid):
                continue
            props = fp.building_properties(building_id, mapping(geom), rainfall, rules, cfg)
            if not props:
                continue
            simple = geom.simplify(tolerance_deg, preserve_topology=True)
            features.append({
                "type": "Feature",
                "properties": {**props, "centroid": [round(centroid.x, 6), round(centroid.y, 6)]},
                "geometry": fp.round_coords(mapping(simple)),
            })

        summary = {
            "slug": ward["slug"],
            "ward": ward["name"],
            "officialName": ward["officialName"],
            "wardNo": ward["wardNo"],
            **fp.summarise(features),
            "rainfallMm": rainfall,
            "rainfallSource": rain_source,
            "centroid": [round(centre.x, 6), round(centre.y, 6)],
            "bbox": [round(v, 6) for v in boundary.bounds],
            "boundary": fp.round_coords(mapping(boundary.simplify(tolerance_deg * 10))),
            "overtureRelease": release,
            "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        collection = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")).encode()
        write(args, f"public-data/wards/{ward['slug']}/buildings.geojson.gz", gzip.compress(collection, 9), "application/geo+json", gzipped=True)
        write(args, f"public-data/wards/{ward['slug']}/summary.json", json.dumps(summary).encode(), "application/json")
        index.append({k: v for k, v in summary.items() if k not in ("boundary",)})
        print(f"{ward['name']:13} {summary['buildingCount']:6} buildings, {summary['requiredCount']:5} required, "
              f"{summary['totalLitresPerYear'] / 1e7:7.1f} crore L/yr, {len(collection) / 1e6:5.1f} MB raw")
    write(args, "public-data/wards/wards.json", json.dumps(index).encode(), "application/json")


def write(args: argparse.Namespace, key: str, body: bytes, content_type: str, gzipped: bool = False) -> None:
    if args.local:
        path = BACKEND / ".local" / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return
    import boto3

    extra = {"ContentEncoding": "gzip"} if gzipped else {}
    boto3.client("s3").put_object(Bucket=args.bucket, Key=key, Body=body, ContentType=content_type, **extra)


if __name__ == "__main__":
    main()
