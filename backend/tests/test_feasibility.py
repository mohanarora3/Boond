import pytest

from src.calculator import sizing
from src.calculator.handler import calculate

BASE = {"roofAreaM2": 150.0, "plotAreaM2": 200.0, "residents": 5, "openSpace": True, "roofType": "rcc", "monthlyWaterBill": 800}
FIELDS = ("contaminationSourceNearby", "waterloggingArea", "pitNearFoundation")


@pytest.mark.parametrize("field,reason", [
    ("contaminationSourceNearby", "contamination_risk"),
    ("waterloggingArea", "waterlogging"),
    ("pitNearFoundation", "foundation_risk"),
])
def test_each_yes_switches_to_tank(field, reason, rules, structures):
    plan = calculate({**BASE, field: "yes"}, 700, rules, structures)
    assert plan["structure"]["type"] == "storage_tank"
    assert plan["structure"]["rechargeRuledOut"] is True
    assert plan["feasibility"]["reasons"] == [reason]


def test_not_sure_warns_but_keeps_structure(rules, structures):
    baseline = calculate(BASE, 700, rules, structures)
    for field in FIELDS:
        plan = calculate({**BASE, field: "not_sure"}, 700, rules, structures)
        assert plan["structure"] == baseline["structure"]
        assert len(plan["feasibility"]["warnings"]) == 1 and plan["feasibility"]["reasons"] == []


def test_old_plans_without_answers_calculate_exactly_as_before(rules, structures):
    plan = calculate(BASE, 700, rules, structures)
    assert plan["structure"]["type"] == "recharge_pit" and plan["structure"]["rechargeRuledOut"] is False
    assert plan["feasibility"] == {"reasons": [], "warnings": []}
    no = calculate({**BASE, **{f: "no" for f in FIELDS}}, 700, rules, structures)
    assert no["structure"] == plan["structure"] and no["money"] == plan["money"]


def test_no_open_space_is_tank_but_not_marked_ruled_out(rules, structures):
    plan = calculate({**BASE, "openSpace": False, "contaminationSourceNearby": "yes"}, 700, rules, structures)
    assert plan["structure"]["type"] == "storage_tank" and plan["structure"]["rechargeRuledOut"] is False


def test_feasibility_function(structures):
    out = sizing.feasibility({"contaminationSourceNearby": "yes", "waterloggingArea": "not_sure"}, structures)
    assert out == {"reasons": ["contamination_risk"], "warnings": ["waterlogging"]}


def test_api_validates_safety_answers(local_env):
    from src.plans.handler import lambda_handler
    from tests.helpers import PLAN_BODY, call

    assert call(lambda_handler, "POST", {**PLAN_BODY, "waterloggingArea": "maybe"})[0] == 400
    status, body = call(lambda_handler, "POST", {**PLAN_BODY, "pitNearFoundation": "yes"})
    assert status == 201 and body["data"]["structure"]["type"] == "storage_tank"


def test_agent_explains_safety(rules):
    from src.agent.tools import explain

    out = explain("septic", rules)
    assert "safety" in out["topics"] and "contamination_risk" in out["topics"]["safety"]["checks"]
