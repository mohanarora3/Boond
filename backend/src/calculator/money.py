"""Compliance and money maths. Pure functions; all policy numbers from delhi_rules.json."""
from __future__ import annotations

from typing import Any


def is_mandatory(plot_area_m2: float, rules: dict[str, Any]) -> bool:
    return plot_area_m2 >= rules["mandatory_min_plot_m2"]


def subsidy(install_cost: float, rules: dict[str, Any]) -> float:
    return min(rules["max_assistance_inr"], install_cost * rules["assistance_fraction"])


def annual_rebate(monthly_water_bill: float, rules: dict[str, Any]) -> float:
    return monthly_water_bill * 12 * rules["rebate_fraction"]


def penalty_avoided(monthly_water_bill: float, mandatory: bool, rules: dict[str, Any]) -> float:
    return monthly_water_bill * 12 * rules["penalty_fraction"] if mandatory else 0.0


def tanker_savings(tankers_per_year: float, rules: dict[str, Any]) -> float:
    return tankers_per_year * rules["tanker_price_inr"]


def payback_years(net_cost: float, annual_benefit: float) -> float | None:
    if annual_benefit <= 0:
        return None
    return round(net_cost / annual_benefit, 1)


def compute_money(
    install_cost: float,
    mandatory: bool,
    monthly_water_bill: float,
    tankers_per_year: float,
    rules: dict[str, Any],
    tank_water_litres: float = 0,
    water_price_inr_per_kl: float = 0,
) -> dict[str, Any]:
    """tank_water_litres: rainwater a household uses from its tank in a year, valued at water_price_inr_per_kl."""
    sub = subsidy(install_cost, rules)
    net = install_cost - sub
    rebate = annual_rebate(monthly_water_bill, rules)
    penalty = penalty_avoided(monthly_water_bill, mandatory, rules)
    tankers = tanker_savings(tankers_per_year, rules)
    tank_water = tank_water_litres / 1000 * water_price_inr_per_kl
    benefit = rebate + penalty + tankers + tank_water
    return {
        "installCostInr": round(install_cost),
        "subsidyInr": round(sub),
        "netCostInr": round(net),
        "annualRebateInr": round(rebate),
        "penaltyAvoidedInr": round(penalty),
        "tankerSavingsInr": round(tankers),
        "tankWaterValueInr": round(tank_water),
        "annualBenefitInr": round(benefit),
        "paybackYears": payback_years(net, benefit),
    }
