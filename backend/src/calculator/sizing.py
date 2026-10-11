"""Water volumes and structure recommendation. Pure functions; all numbers from config."""
from __future__ import annotations

import math
from typing import Any


def runoff_coefficient(roof_type: str, rules: dict[str, Any]) -> float:
    coeffs = rules["runoff_coefficients"]
    return float(coeffs.get(roof_type, coeffs[rules["default_roof_type"]]))


def litres_per_year(roof_area_m2: float, annual_rainfall_mm: float, coefficient: float) -> float:
    # 1 mm of rain on 1 m² = 1 litre
    return roof_area_m2 * annual_rainfall_mm * coefficient


def tankers_equivalent(litres: float, tanker_litres: float) -> float:
    return litres / tanker_litres


def design_storm_litres(roof_area_m2: float, coefficient: float, structures: dict[str, Any]) -> float:
    """Runoff from one design storm — what a recharge structure must hold at once."""
    rain_mm = structures["design_rainfall_mm_per_hour"] * structures["design_storm_minutes"] / 60
    return roof_area_m2 * rain_mm * coefficient


def _round_up(value: float, step: float = 0.1) -> float:
    return round(math.ceil(value / step - 1e-9) * step, 2)


def size_recharge_pit(volume_litres: float, cfg: dict[str, Any]) -> dict[str, Any]:
    """Square pit(s) of fixed depth; side clamped to [min, max]; more pits if one is not enough."""
    volume_m3 = volume_litres / 1000
    depth = cfg["depth_m"]
    max_pit_m3 = cfg["max_side_m"] ** 2 * depth
    count = max(1, math.ceil(volume_m3 / max_pit_m3 - 1e-9))
    side = _round_up(math.sqrt(volume_m3 / count / depth))
    side = min(max(side, cfg["min_side_m"]), cfg["max_side_m"])
    excavation_m3 = side * side * depth * count
    return {
        "type": "recharge_pit",
        "label": cfg["label"],
        "count": count,
        "dimensions": {"lengthM": side, "widthM": side, "depthM": depth},
        "capacityLitres": round(excavation_m3 * 1000),
        "structureCostInr": round(excavation_m3 * cfg["cost_per_m3_inr"]),
    }


def size_recharge_trench(volume_litres: float, cfg: dict[str, Any]) -> dict[str, Any]:
    width, depth = cfg["width_m"], cfg["depth_m"]
    length = max(cfg["min_length_m"], _round_up(volume_litres / 1000 / (width * depth), 0.5))
    excavation_m3 = length * width * depth
    return {
        "type": "recharge_trench",
        "label": cfg["label"],
        "count": 1,
        "dimensions": {"lengthM": length, "widthM": width, "depthM": depth},
        "capacityLitres": round(excavation_m3 * 1000),
        "structureCostInr": round(excavation_m3 * cfg["cost_per_m3_inr"]),
    }


def size_storage_tank(needed_litres: float, cfg: dict[str, Any]) -> dict[str, Any]:
    """Smallest standard tank that fits; if none, several of the largest."""
    sizes = sorted(cfg["sizes"], key=lambda s: s["litres"])
    chosen = next((s for s in sizes if s["litres"] >= needed_litres), None)
    count = 1
    if chosen is None:
        chosen = sizes[-1]
        count = math.ceil(needed_litres / chosen["litres"])
    return {
        "type": "storage_tank",
        "label": cfg["label"],
        "count": count,
        "dimensions": {"litresEach": chosen["litres"]},
        "capacityLitres": chosen["litres"] * count,
        "structureCostInr": chosen["cost_inr"] * count,
    }


def household_storage_litres(residents: int, cfg: dict[str, Any]) -> float:
    return residents * cfg["litres_per_person_per_day"] * cfg["storage_days"]


def feasibility(answers: dict[str, Any], structures: dict[str, Any]) -> dict[str, list[str]]:
    """Site-safety answers → reasons a recharge pit is ruled out ("yes") and things to check ("not_sure").
    Missing answers and "no" change nothing, so older plans calculate exactly as before."""
    reasons: list[str] = []
    warnings: list[str] = []
    for field, q in structures["feasibility"]["questions"].items():
        answer = answers.get(field)
        if answer == "yes":
            reasons.append(q["reason"])
        elif answer == "not_sure":
            warnings.append(q["reason"])
    return {"reasons": reasons, "warnings": warnings}


def recommend_structure(
    roof_area_m2: float, coefficient: float, residents: int, open_space: bool, structures: dict[str, Any],
    recharge_ruled_out: bool = False,
) -> dict[str, Any]:
    """Open space → recharge pit (small roof) or trench (large roof), with an optional tank.
    No open space, or recharge unsafe at this site → storage tank only. installCostInr includes the first-flush filter."""
    storm_litres = design_storm_litres(roof_area_m2, coefficient, structures)
    tank_cfg = structures["storage_tank"]

    if open_space and not recharge_ruled_out:
        if roof_area_m2 <= structures["recharge_pit"]["max_roof_m2"]:
            rec = size_recharge_pit(storm_litres, structures["recharge_pit"])
        else:
            rec = size_recharge_trench(storm_litres, structures["recharge_trench"])
        rec["optionalTank"] = size_storage_tank(household_storage_litres(residents, tank_cfg), tank_cfg)
    else:
        needed = max(storm_litres, household_storage_litres(residents, tank_cfg))
        rec = size_storage_tank(needed, tank_cfg)
        rec["optionalTank"] = None

    rec["rechargeRuledOut"] = bool(open_space and recharge_ruled_out)
    rec["designStormLitres"] = round(storm_litres)
    rec["filterCostInr"] = structures["first_flush_filter_cost_inr"]
    rec["installCostInr"] = rec["structureCostInr"] + rec["filterCostInr"]
    return rec
