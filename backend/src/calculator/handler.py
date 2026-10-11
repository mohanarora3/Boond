"""Turns validated plan inputs + rainfall into the plan's numbers. Pure; used by the plans API and the agent."""
from __future__ import annotations

from typing import Any

from src.calculator import money, sizing, water_balance


def calculate(
    inputs: dict[str, Any], rainfall_mm: float, rules: dict[str, Any], structures: dict[str, Any],
    daily: dict[str, list[Any]] | None = None,
) -> dict[str, Any]:
    """litresPerYear = all the rain that runs off the roof in an average year.
    water = what the recommended system actually saves, replayed day by day (None without daily rainfall)."""
    roof_type = inputs.get("roofType") or rules["default_roof_type"]
    coeff = sizing.runoff_coefficient(roof_type, rules)
    litres = sizing.litres_per_year(inputs["roofAreaM2"], rainfall_mm, coeff)
    mandatory = money.is_mandatory(inputs["plotAreaM2"], rules)
    # Safety questions only matter where a recharge pit could be dug.
    checks = sizing.feasibility(inputs, structures) if inputs["openSpace"] else {"reasons": [], "warnings": []}
    structure = sizing.recommend_structure(
        inputs["roofAreaM2"], coeff, inputs["residents"], inputs["openSpace"], structures,
        recharge_ruled_out=bool(checks["reasons"]),
    )
    water = water_balance.simulate(daily, inputs["roofAreaM2"], coeff, structure, inputs["residents"], structures)
    tank_litres = water["savedLitres"] if water and water["kind"] == "use" else 0
    return {
        "rainfallMm": rainfall_mm,
        "runoffCoefficient": coeff,
        "litresPerYear": round(litres),
        "tankersEquivalent": round(sizing.tankers_equivalent(litres, rules["tanker_litres"]), 1),
        "mandatory": mandatory,
        "structure": structure,
        "feasibility": checks,
        "water": water,
        "money": money.compute_money(
            structure["installCostInr"],
            mandatory,
            inputs.get("monthlyWaterBill") or 0,
            inputs.get("tankersPerYear") or 0,
            rules,
            tank_water_litres=tank_litres,
            water_price_inr_per_kl=structures["water_balance"]["water_price_inr_per_kl"],
        ),
    }
