"""Strands tools for the Boond assistant, bound to one plan so the model can't read or change other plans."""
from __future__ import annotations

from typing import Any

from strands import tool

from src.application.pdf import generate_application as _generate_application
from src.common import config
from src.plans import service

CHANGEABLE = ("roofAreaM2", "plotAreaM2", "residents", "openSpace", "roofType", "monthlyWaterBill", "tankersPerYear")


def summarise(plan: dict[str, Any]) -> dict[str, Any]:
    """The facts the model needs, without the polygon or internal fields."""
    s, m = plan["structure"], plan["money"]
    return {
        "address": plan["address"],
        "status": plan["status"],
        "inputs": {k: plan.get(k) for k in CHANGEABLE},
        "annualRainfallMm": plan["rainfallMm"],
        "litresPerYear": plan["litresPerYear"],
        "tankersEquivalent": plan["tankersEquivalent"],
        "mandatory": plan["mandatory"],
        "structure": {
            "type": s["type"],
            "count": s["count"],
            "dimensions": s["dimensions"],
            "capacityLitres": s["capacityLitres"],
            "optionalTankLitres": s["optionalTank"]["capacityLitres"] if s.get("optionalTank") else None,
        },
        "safety": {
            "rechargeRuledOut": s.get("rechargeRuledOut", False),
            "reasons": plan.get("feasibility", {}).get("reasons", []),
            "thingsToCheck": plan.get("feasibility", {}).get("warnings", []),
        },
        "moneyInRupees": {
            "totalInstallationCost": m["installCostInr"],
            "governmentAssistance": m["subsidyInr"],
            "ownerPaysAfterAssistance": m["netCostInr"],
            "yearlyWaterBillRebate": m["annualRebateInr"],
            "yearlyPenaltyAvoided": m["penaltyAvoidedInr"],
            "yearlyTankerSavings": m["tankerSavingsInr"],
            "totalYearlyBenefit": m["annualBenefitInr"],
            "paybackYears": m["paybackYears"],
        },
    }


def _coerce(key: str, value: Any) -> Any:
    """Small models sometimes send "true" or "120" as strings; accept those."""
    if isinstance(value, str):
        v = value.strip().lower()
        if key == "openSpace" and v in ("true", "yes", "false", "no"):
            return v in ("true", "yes")
        if key != "roofType":
            try:
                return float(v)
            except ValueError:
                return value
    return value


def collect_changes(**kwargs: Any) -> dict[str, Any]:
    changes = {k: _coerce(k, v) for k, v in kwargs.items() if v is not None and k in CHANGEABLE}
    if not changes:
        raise ValueError("Give at least one input to change")
    return changes


def explain(topic: str, rules: dict[str, Any]) -> dict[str, Any]:
    authority = rules["authority_name"]
    topics: dict[str, dict[str, Any]] = {
        "mandatory": {
            "mandatory_min_plot_m2": rules["mandatory_min_plot_m2"],
            "explanation": f"Rainwater harvesting is mandatory for plots of {rules['mandatory_min_plot_m2']} sq m or more.",
        },
        "subsidy": {
            "max_assistance_inr": rules["max_assistance_inr"],
            "assistance_fraction": rules["assistance_fraction"],
            "explanation": (
                f"Financial assistance of up to {rules['assistance_fraction']:.0%} of the installation cost, "
                f"capped at Rs {rules['max_assistance_inr']:,}."
            ),
        },
        "rebate": {
            "rebate_fraction": rules["rebate_fraction"],
            "explanation": f"A working system can earn up to {rules['rebate_fraction']:.0%} rebate on the water bill.",
        },
        "penalty": {
            "penalty_fraction": rules["penalty_fraction"],
            "explanation": (
                f"Non-compliance on a mandatory plot is reported to attract a penalty of {rules['penalty_fraction']:.0%} "
                "of the water bill."
            ),
        },
        "tanker": {
            "tanker_litres": rules["tanker_litres"],
            "tanker_price_inr": rules["tanker_price_inr"],
            "explanation": f"One private tanker is about {rules['tanker_litres']:,} litres and costs about Rs {rules['tanker_price_inr']:,}.",
        },
        "documents": {"documents": rules["application_documents"]},
        "safety": {
            "checks": {q["reason"]: {"why": q["reason_text"], "what_to_check": q["check_text"]}
                       for q in config.structures()["feasibility"]["questions"].values()},
            "explanation": "Boond does not recommend a recharge pit if a septic tank or sewer is nearby, the area waterlogs, "
                           "or the only open ground is next to the foundation. A storage tank is the safer option then.",
            "source": config.structures()["feasibility"]["_source"],
        },
    }
    key = topic.strip().lower()
    aliases = {"septic": "safety", "contamination": "safety", "foundation": "safety", "waterlogging": "safety",
               "assistance": "subsidy", "money": "subsidy", "fine": "penalty", "tankers": "tanker", "apply": "documents",
               "application": "documents", "compulsory": "mandatory"}
    key = aliases.get(key, key)
    picked = topics if key in ("", "all") else {key: topics[key]} if key in topics else topics
    return {
        "topics": picked,
        "source": rules["source_note"],
        "must_confirm_with": authority,
    }


def make_tools(plan_id: str) -> list[Any]:
    @tool
    def get_plan() -> dict[str, Any]:
        """Get the user's current saved rainwater plan: inputs, litres per year, recommended structure and money."""
        return summarise(service.get_plan(plan_id))

    @tool
    def recalculate(
        roofAreaM2: float | None = None,
        plotAreaM2: float | None = None,
        residents: int | None = None,
        openSpace: bool | None = None,
        roofType: str | None = None,
        monthlyWaterBill: float | None = None,
        tankersPerYear: float | None = None,
    ) -> dict[str, Any]:
        """Preview the plan with changed inputs WITHOUT saving. Use for any "what if" question.
        Pass only the inputs that change.

        Args:
            roofAreaM2: Roof area in square metres.
            plotAreaM2: Plot (land) area in square metres.
            residents: Number of people living there.
            openSpace: true if there is open ground (backyard, lawn, driveway) for a recharge pit, false if not.
            roofType: "rcc", "tin" or "tiles".
            monthlyWaterBill: Water bill in rupees per month.
            tankersPerYear: Water tankers bought per year.
        """
        changes = collect_changes(roofAreaM2=roofAreaM2, plotAreaM2=plotAreaM2, residents=residents, openSpace=openSpace,
                                  roofType=roofType, monthlyWaterBill=monthlyWaterBill, tankersPerYear=tankersPerYear)
        before = summarise(service.get_plan(plan_id))
        after = summarise(service.preview_changes(plan_id, changes))
        return {"saved": False, "changes": changes, "before": before, "after": after}

    @tool
    def save_plan_changes(
        roofAreaM2: float | None = None,
        plotAreaM2: float | None = None,
        residents: int | None = None,
        openSpace: bool | None = None,
        roofType: str | None = None,
        monthlyWaterBill: float | None = None,
        tankersPerYear: float | None = None,
    ) -> dict[str, Any]:
        """Save changed inputs to the user's plan. ONLY call after the user explicitly confirmed saving these changes.
        Pass only the inputs that change (same meaning as in recalculate).

        Args:
            roofAreaM2: Roof area in square metres.
            plotAreaM2: Plot (land) area in square metres.
            residents: Number of people living there.
            openSpace: true if there is open ground for a recharge pit, false if not.
            roofType: "rcc", "tin" or "tiles".
            monthlyWaterBill: Water bill in rupees per month.
            tankersPerYear: Water tankers bought per year.
        """
        changes = collect_changes(roofAreaM2=roofAreaM2, plotAreaM2=plotAreaM2, residents=residents, openSpace=openSpace,
                                  roofType=roofType, monthlyWaterBill=monthlyWaterBill, tankersPerYear=tankersPerYear)
        return {"saved": True, "plan": summarise(service.update_plan(plan_id, changes))}

    @tool
    def explain_rules(topic: str) -> dict[str, Any]:
        """Get Delhi rainwater harvesting rules with plain-language explanations.

        Args:
            topic: One of "mandatory", "subsidy", "rebate", "penalty", "tanker", "documents", "safety" or "all".
        """
        return explain(topic, config.rules())

    @tool
    def generate_application() -> dict[str, Any]:
        """Create the application summary PDF with the document checklist and return a download link.
        ONLY call after the user explicitly asked for or confirmed creating the application."""
        result = _generate_application(plan_id)
        return {"downloadUrl": result["url"], "status": result["status"], "linkValidMinutes": 15}

    @tool
    def maintenance_tips(structure: str = "") -> dict[str, Any]:
        """Maintenance checklist for a rainwater structure.

        Args:
            structure: "recharge_pit", "recharge_trench" or "storage_tank". Leave empty to use the plan's structure.
        """
        tips = config.structures()["maintenance"]
        kind = structure if structure in tips else service.get_plan(plan_id)["structure"]["type"]
        return {"structure": kind, "checklist": tips[kind]}

    return [get_plan, recalculate, save_plan_changes, explain_rules, generate_application, maintenance_tips]
