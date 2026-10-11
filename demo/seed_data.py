"""Seed ~40 demo plans across 4 Delhi wards for the ward dashboard.

    python demo/seed_data.py --local            # backend/.local/db.json (local_server.py)
    python demo/seed_data.py --table <name>     # DynamoDB table from the deployed stack

Plan IDs are deterministic (demo-<ward>-<n>), so re-running overwrites instead of duplicating.
Seeded plans are marked seeded=true and never get reminder emails.
"""
from __future__ import annotations

import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

# Approximate locality centres.
WARDS = {
    "Dwarka": (28.5921, 77.0460),
    "Rohini": (28.7383, 77.0822),
    "Mayur Vihar": (28.6077, 77.2924),
    "Lajpat Nagar": (28.5677, 77.2433),
}
PLANS_PER_WARD = 10
STATUS_WEIGHTS = {"planned": 3, "applied": 2, "installed": 2, "verified": 2, "needs_attention": 1}


def slug(ward: str) -> str:
    return ward.lower().replace(" ", "-")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--local", action="store_true", help="write to backend/.local/db.json")
    target.add_argument("--table", help="DynamoDB table name")
    args = parser.parse_args()

    if args.local:
        os.environ["BOOND_LOCAL_DB"] = str(BACKEND / ".local" / "db.json")
    else:
        os.environ["TABLE_NAME"] = args.table

    from src.calculator.rainfall import cache_key, get_annual_rainfall
    from src.common import config
    from src.common.db import get_store
    from src.plans import service

    rng = random.Random(2026)
    store, rules = get_store(), config.rules()
    now = datetime.now(timezone.utc)
    statuses, weights = zip(*STATUS_WEIGHTS.items())

    for ward, (lat0, lon0) in WARDS.items():
        rainfall, source = get_annual_rainfall(lat0, lon0, rules, store)
        print(f"{ward}: {rainfall} mm/year ({source})")
        for n in range(1, PLANS_PER_WARD + 1):
            lat, lon = round(lat0 + rng.uniform(-0.008, 0.008), 5), round(lon0 + rng.uniform(-0.008, 0.008), 5)
            # Reuse the ward's rainfall for nearby points instead of one API call per plan.
            store.put({"PK": cache_key(lat, lon), "SK": "META", "annualMm": rainfall, "fetchedAt": now.isoformat()})
            roof = rng.choice([60, 80, 100, 120, 150, 200, 250, 300, 400])
            status = rng.choices(statuses, weights)[0]
            extra = {"seeded": True}
            if status in ("installed", "verified", "needs_attention"):
                extra["installedAt"] = (now - timedelta(days=rng.randint(30, 400))).isoformat(timespec="seconds")
            if status in ("verified", "needs_attention"):
                extra["lastCheckAt"] = (now - timedelta(days=rng.randint(1, 25))).isoformat(timespec="seconds")
            service.create_plan(
                {
                    "address": f"House {rng.randint(1, 250)}, Block {rng.choice('ABCDEFGH')}, {ward}, Delhi",
                    "lat": lat,
                    "lon": lon,
                    "ward": ward,
                    "roofAreaM2": roof,
                    "plotAreaM2": round(roof * rng.uniform(1.0, 1.6)),
                    "residents": rng.randint(2, 9),
                    "openSpace": rng.random() < 0.7,
                    "monthlyWaterBill": rng.choice([300, 500, 800, 1200, 2000]),
                    "tankersPerYear": rng.choice([0, 0, 0, 2, 6, 12]),
                },
                plan_id=f"demo-{slug(ward)}-{n:02d}",
                status=status,
                extra=extra,
            )
    print(f"Seeded {len(WARDS) * PLANS_PER_WARD} plans across {len(WARDS)} wards.")


if __name__ == "__main__":
    main()
