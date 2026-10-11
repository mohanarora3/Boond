import pytest

from src.calculator import sizing


def test_runoff_coefficient_by_type_and_default(rules):
    assert sizing.runoff_coefficient("tin", rules) == rules["runoff_coefficients"]["tin"]
    default = rules["runoff_coefficients"][rules["default_roof_type"]]
    assert sizing.runoff_coefficient("unknown", rules) == default


def test_litres_per_year():
    assert sizing.litres_per_year(100, 750, 0.8) == pytest.approx(60_000)


def test_tankers_equivalent():
    assert sizing.tankers_equivalent(60_000, 10_000) == 6


def test_design_storm_litres(structures):
    rain_mm = structures["design_rainfall_mm_per_hour"] * structures["design_storm_minutes"] / 60
    assert sizing.design_storm_litres(100, 0.8, structures) == pytest.approx(100 * rain_mm * 0.8)


def test_small_pit_clamped_to_min_side(structures):
    cfg = structures["recharge_pit"]
    pit = sizing.size_recharge_pit(100, cfg)
    assert pit["count"] == 1
    assert pit["dimensions"]["lengthM"] == cfg["min_side_m"]
    assert pit["capacityLitres"] >= 100


def test_large_volume_needs_multiple_pits(structures):
    cfg = structures["recharge_pit"]
    one_pit_litres = cfg["max_side_m"] ** 2 * cfg["depth_m"] * 1000
    pit = sizing.size_recharge_pit(one_pit_litres * 2.5, cfg)
    assert pit["count"] == 3
    assert pit["dimensions"]["lengthM"] <= cfg["max_side_m"]
    assert pit["capacityLitres"] >= one_pit_litres * 2.5


def test_pit_capacity_covers_volume(structures):
    cfg = structures["recharge_pit"]
    for litres in (500, 3_000, 9_000, 15_000):
        pit = sizing.size_recharge_pit(litres, cfg)
        assert pit["capacityLitres"] >= litres
        assert pit["structureCostInr"] == round(pit["capacityLitres"] / 1000 * cfg["cost_per_m3_inr"])


def test_trench_length_covers_volume(structures):
    cfg = structures["recharge_trench"]
    trench = sizing.size_recharge_trench(12_000, cfg)
    assert trench["capacityLitres"] >= 12_000
    assert trench["dimensions"]["lengthM"] >= cfg["min_length_m"]


def test_tank_picks_smallest_fitting_size(structures):
    cfg = structures["storage_tank"]
    tank = sizing.size_storage_tank(1_500, cfg)
    assert tank["count"] == 1
    assert tank["capacityLitres"] == 2_000


def test_tank_uses_several_of_largest_when_needed(structures):
    cfg = structures["storage_tank"]
    largest = max(s["litres"] for s in cfg["sizes"])
    tank = sizing.size_storage_tank(largest * 2 + 1, cfg)
    assert tank["count"] == 3
    assert tank["capacityLitres"] == largest * 3


def test_open_space_small_roof_gets_pit_and_optional_tank(structures):
    rec = sizing.recommend_structure(120, 0.8, 4, True, structures)
    assert rec["type"] == "recharge_pit"
    assert rec["optionalTank"]["type"] == "storage_tank"
    assert rec["installCostInr"] == rec["structureCostInr"] + structures["first_flush_filter_cost_inr"]


def test_open_space_large_roof_gets_trench(structures):
    rec = sizing.recommend_structure(structures["recharge_pit"]["max_roof_m2"] + 1, 0.8, 4, True, structures)
    assert rec["type"] == "recharge_trench"


def test_no_open_space_gets_tank_only(structures):
    rec = sizing.recommend_structure(120, 0.8, 4, False, structures)
    assert rec["type"] == "storage_tank"
    assert rec["optionalTank"] is None
    assert rec["capacityLitres"] >= rec["designStormLitres"]
