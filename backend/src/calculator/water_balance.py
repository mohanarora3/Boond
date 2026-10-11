"""How much roof water a system actually saves, replayed day by day over the last 10 years of real rainfall.

A yearly total (rain x roof x runoff) over-counts: rain arrives in a few heavy days, and a tank or pit can only take
so much at once. Each day:

  water in  = that day's rain (mm) x roof area (m2) x runoff coefficient          (1 mm on 1 m2 = 1 litre)
  tank      : water goes into the tank up to its size, the rest overflows (lost); then the household draws its daily
              use from the tank. Saved = what the household used.
  pit/trench: the structure takes up to capacity x daily_cycles (it soaks away and refills through a day of bursts);
              the rest overflows. Saved = what went into the ground.

Pure function; the daily series comes from the rainfall cache.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

RECHARGE_TYPES = ("recharge_pit", "recharge_trench")


def _run(dates: list[str], mm: list[float | None], roof_m2: float, coeff: float, kind: str, capacity_l: float,
         daily_use_l: float, cycles: float) -> dict[str, Any]:
    by_year: dict[str, dict[str, float]] = defaultdict(lambda: {"rain": 0.0, "inflow": 0.0, "saved": 0.0, "lost": 0.0})
    by_month: dict[int, dict[str, float]] = defaultdict(lambda: {"saved": 0.0, "lost": 0.0})
    stored = 0.0
    for day, value in zip(dates, mm):
        rain = float(value or 0.0)
        inflow = rain * roof_m2 * coeff
        y = by_year[day[:4]]
        y["rain"] += rain
        y["inflow"] += inflow
        month = int(day[5:7])
        if kind == "recharge":
            taken = min(inflow, capacity_l * cycles)
            saved, lost = taken, inflow - taken
        else:
            stored += inflow
            lost = max(0.0, stored - capacity_l)
            stored -= lost
            saved = min(stored, daily_use_l)
            stored -= saved
        y["saved"] += saved
        y["lost"] += lost
        by_month[month]["saved"] += saved
        by_month[month]["lost"] += lost
    n = len(by_year) or 1
    years = [{"year": int(k), "rainMm": round(v["rain"]), "rainOnRoofLitres": round(v["inflow"]),
              "savedLitres": round(v["saved"]), "lostLitres": round(v["lost"])} for k, v in sorted(by_year.items())]
    return {
        "n": n,
        "years": years,
        "inflow": sum(v["inflow"] for v in by_year.values()) / n,
        "saved": sum(v["saved"] for v in by_year.values()) / n,
        "lost": sum(v["lost"] for v in by_year.values()) / n,
        "monthly": [{"month": m, "savedLitres": round(by_month[m]["saved"] / n), "lostLitres": round(by_month[m]["lost"] / n)}
                    for m in range(1, 13)],
    }


def simulate(daily: dict[str, list[Any]] | None, roof_m2: float, coeff: float, structure: dict[str, Any], residents: int,
             structures: dict[str, Any]) -> dict[str, Any] | None:
    """The water block of a plan, or None when no daily rainfall is available."""
    if not daily or not daily.get("dates"):
        return None
    cfg = structures["water_balance"]
    cycles = structures["simulation"]["daily_cycles"]
    kind = "recharge" if structure["type"] in RECHARGE_TYPES else "use"
    daily_use = residents * cfg["use_litres_per_person_per_day"]
    run = _run(daily["dates"], daily["mm"], roof_m2, coeff, kind, structure["capacityLitres"], daily_use, cycles)
    years = run["years"]
    dry = min(years, key=lambda y: y["rainMm"])
    wet = max(years, key=lambda y: y["rainMm"])
    out: dict[str, Any] = {
        "kind": kind,
        "yearsSimulated": run["n"],
        "firstYear": years[0]["year"],
        "lastYear": years[-1]["year"],
        "rainOnRoofLitres": round(run["inflow"]),
        "savedLitres": round(run["saved"]),
        "lostLitres": round(run["lost"]),
        "savedShare": round(run["saved"] / run["inflow"], 3) if run["inflow"] else 0.0,
        "periodSavedLitres": sum(y["savedLitres"] for y in years),
        "dryYear": dry,
        "wetYear": wet,
        "monthly": run["monthly"],
        "dailyUseLitres": round(daily_use) if kind == "use" else None,
        "upgrade": None,
    }
    if kind == "use":
        sizes = sorted(structures["storage_tank"]["sizes"], key=lambda s: s["litres"])
        each = structure["dimensions"].get("litresEach") or structure["capacityLitres"]
        current = next((s for s in sizes if s["litres"] == each), None)
        bigger = next((s for s in sizes if s["litres"] > each), None)
        if current and bigger:
            count = structure.get("count", 1)
            alt = _run(daily["dates"], daily["mm"], roof_m2, coeff, kind, bigger["litres"] * count, daily_use, cycles)
            extra = round(alt["saved"] - run["saved"])
            if extra > 0:
                out["upgrade"] = {"litresEach": bigger["litres"], "count": count, "extraSavedLitres": extra,
                                  "extraCostInr": (bigger["cost_inr"] - current["cost_inr"]) * count}
    return out
