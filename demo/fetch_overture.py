"""Download Overture Maps buildings for the demo wards' bounding boxes into a local Parquet cache.

    python demo/fetch_overture.py [--release 2026-09-23.1]

Slow the first time (DuckDB reads Overture's worldwide file metadata); afterwards build_footprints.py
works offline from demo/data/overture_buildings.parquet.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "demo" / "data"
STRUCTURES = ROOT / "backend" / "config" / "structures.json"


def ward_bboxes() -> list[tuple[float, float, float, float]]:
    from shapely.geometry import shape

    wards = json.loads(STRUCTURES.read_text())["footprints"]["wards"]
    features = {f["properties"]["Ward_No"]: f for f in json.loads((DATA / "delhi_wards.geojson").read_text())["features"]}
    return [shape(features[w["wardNo"]]["geometry"]).bounds for w in wards]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--release", default="2026-09-23.1")
    args = parser.parse_args()

    import duckdb

    pad = 0.002  # ~200 m so buildings on ward edges aren't clipped
    out = DATA / "overture_buildings.parquet"
    con = duckdb.connect()
    # Object cache: Overture's file footers are fetched once and reused by every per-ward query.
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2'; SET enable_object_cache=true;")
    src = f"s3://overturemaps-us-west-2/release/{args.release}/theme=buildings/type=building/*"
    started = time.time()
    con.execute("CREATE TABLE buildings (id VARCHAR, wkb BLOB, sources STRUCT(dataset VARCHAR, confidence DOUBLE)[])")
    # One AND-only range filter per ward: DuckDB can skip row groups by their bbox statistics (an OR of boxes can't).
    for i, (x0, y0, x1, y1) in enumerate(ward_bboxes(), 1):
        t0 = time.time()
        con.execute(f"""
            INSERT INTO buildings
            SELECT id, ST_AsWKB(geometry),
                   list_transform(sources, s -> struct_pack(dataset := s.dataset, confidence := s.confidence))
            FROM read_parquet('{src}', hive_partitioning = 1)
            WHERE bbox.xmin BETWEEN {x0 - pad - 0.01} AND {x1 + pad}
              AND bbox.ymin BETWEEN {y0 - pad - 0.01} AND {y1 + pad}
              AND bbox.xmax > {x0 - pad} AND bbox.ymax > {y0 - pad}
        """)
        print(f"ward box {i}: done in {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
    con.execute(f"COPY (SELECT DISTINCT ON (id) * FROM buildings) TO '{out}' (FORMAT PARQUET)")
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out}')").fetchone()[0]
    (DATA / "overture_release.txt").write_text(args.release + "\n")
    print(f"Saved {n} buildings to {out} in {time.time() - started:.0f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
