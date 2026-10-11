"""GET /rules — the public policy and cost figures the UI explains, straight from config (never hard-coded in the UI)."""
from __future__ import annotations

from typing import Any

from src.common import config
from src.common.responses import api_handler, ok

PUBLIC_RULES = (
    "mandatory_min_plot_m2", "max_assistance_inr", "assistance_fraction", "rebate_fraction", "penalty_fraction",
    "tanker_litres", "tanker_price_inr", "runoff_coefficients", "authority_name",
)


def public_rules() -> dict[str, Any]:
    rules, structures = config.rules(), config.structures()
    sources = {k: v for k, v in rules.get("_sources", {}).items() if not k.startswith("_")}
    return {
        **{k: rules[k] for k in PUBLIC_RULES},
        "sources": sources,
        "designStorm": {
            "mmPerHour": structures["design_rainfall_mm_per_hour"],
            "minutes": structures["design_storm_minutes"],
        },
        "filterCostInr": structures["first_flush_filter_cost_inr"],
    }


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return ok(public_rules())
