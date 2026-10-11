import pytest

from src.calculator import money


def test_mandatory_threshold_is_inclusive(rules):
    limit = rules["mandatory_min_plot_m2"]
    assert money.is_mandatory(limit, rules) is True
    assert money.is_mandatory(limit + 50, rules) is True
    assert money.is_mandatory(limit - 0.1, rules) is False


def test_subsidy_is_fraction_of_cost_when_below_cap(rules):
    assert money.subsidy(20_000, rules) == pytest.approx(20_000 * rules["assistance_fraction"])


def test_subsidy_is_capped(rules):
    huge = rules["max_assistance_inr"] / rules["assistance_fraction"] * 3
    assert money.subsidy(huge, rules) == rules["max_assistance_inr"]


def test_annual_rebate(rules):
    assert money.annual_rebate(1000, rules) == pytest.approx(1000 * 12 * rules["rebate_fraction"])


def test_penalty_only_when_mandatory(rules):
    assert money.penalty_avoided(1000, True, rules) == pytest.approx(1000 * 12 * rules["penalty_fraction"])
    assert money.penalty_avoided(1000, False, rules) == 0


def test_tanker_savings(rules):
    assert money.tanker_savings(4, rules) == 4 * rules["tanker_price_inr"]
    assert money.tanker_savings(0, rules) == 0


def test_payback_none_when_no_benefit():
    assert money.payback_years(10_000, 0) is None


def test_payback_rounded():
    assert money.payback_years(10_000, 3_000) == 3.3


def test_compute_money_mandatory(rules):
    m = money.compute_money(40_000, True, 1_000, 2, rules)
    sub = min(rules["max_assistance_inr"], 40_000 * rules["assistance_fraction"])
    rebate = 12_000 * rules["rebate_fraction"]
    penalty = 12_000 * rules["penalty_fraction"]
    tankers = 2 * rules["tanker_price_inr"]
    assert m["subsidyInr"] == round(sub)
    assert m["netCostInr"] == round(40_000 - sub)
    assert m["annualRebateInr"] == round(rebate)
    assert m["penaltyAvoidedInr"] == round(penalty)
    assert m["tankerSavingsInr"] == tankers
    assert m["annualBenefitInr"] == round(rebate + penalty + tankers)
    assert m["paybackYears"] == round((40_000 - sub) / (rebate + penalty + tankers), 1)


def test_compute_money_non_mandatory_has_no_penalty(rules):
    m = money.compute_money(40_000, False, 1_000, 0, rules)
    assert m["penaltyAvoidedInr"] == 0
    assert m["annualBenefitInr"] == m["annualRebateInr"]


def test_compute_money_zero_benefit(rules):
    m = money.compute_money(40_000, False, 0, 0, rules)
    assert m["annualBenefitInr"] == 0
    assert m["paybackYears"] is None
