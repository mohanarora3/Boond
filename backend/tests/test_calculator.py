from datetime import date

import pytest

from src.calculator import rainfall
from src.calculator.handler import calculate

INPUTS = {
    "roofAreaM2": 150.0, "plotAreaM2": 200.0, "residents": 5, "openSpace": True,
    "roofType": "rcc", "monthlyWaterBill": 800, "tankersPerYear": 0,
}


class MemoryStore:
    def __init__(self):
        self.items = {}

    def get(self, pk, sk):
        return self.items.get((pk, sk))

    def put(self, item):
        self.items[(item["PK"], item["SK"])] = item


def test_calculate_end_to_end(rules, structures):
    plan = calculate(INPUTS, 700.0, rules, structures)
    assert plan["litresPerYear"] == round(150 * 700 * rules["runoff_coefficients"]["rcc"])
    assert plan["tankersEquivalent"] == round(plan["litresPerYear"] / rules["tanker_litres"], 1)
    assert plan["mandatory"] is True
    assert plan["structure"]["type"] == "recharge_pit"
    assert plan["money"]["installCostInr"] == plan["structure"]["installCostInr"]
    assert plan["money"]["paybackYears"] is not None


def test_calculate_small_plot_not_mandatory_no_bill(rules, structures):
    plan = calculate({**INPUTS, "plotAreaM2": 60.0, "monthlyWaterBill": 0, "openSpace": False}, 700.0, rules, structures)
    assert plan["mandatory"] is False
    assert plan["structure"]["type"] == "storage_tank"
    assert plan["money"]["penaltyAvoidedInr"] == 0
    assert plan["money"]["paybackYears"] is None


def test_history_window_is_last_full_years():
    assert rainfall.history_window(date(2026, 10, 8), 10) == (date(2016, 1, 1), date(2025, 12, 31))


def test_annual_average_groups_by_year_and_ignores_nulls():
    dates = ["2024-01-01", "2024-07-01", "2025-01-01", "2025-07-01"]
    assert rainfall.annual_average_mm(dates, [10.0, None, 30.0, 10.0]) == pytest.approx(25.0)


def test_annual_average_empty_raises():
    with pytest.raises(ValueError):
        rainfall.annual_average_mm([], [])


def test_rainfall_fetch_then_cache(rules):
    store = MemoryStore()
    calls = []

    def fake_fetch(lat, lon, start, end):
        calls.append((lat, lon))
        return {"daily": {"time": ["2024-07-01", "2025-07-01"], "precipitation_sum": [700.0, 800.0]}}

    mm, source = rainfall.get_annual_rainfall(28.6139, 77.2090, rules, store, fetch=fake_fetch, today=date(2026, 1, 1))
    assert (mm, source) == (750.0, "open-meteo")
    mm2, source2 = rainfall.get_annual_rainfall(28.6141, 77.2088, rules, store, fetch=fake_fetch)
    assert (mm2, source2) == (750.0, "cache")
    assert len(calls) == 1


def test_rainfall_falls_back_to_default_on_error(rules):
    def broken(*_):
        raise TimeoutError

    mm, source = rainfall.get_annual_rainfall(28.6, 77.2, rules, None, fetch=broken)
    assert (mm, source) == (rules["default_annual_rainfall_mm"], "default")
