import pytest

from src.wards.simulate import simulate
from tests.test_footprints import CFG, rect
from src.wards import footprints as fp


def building(i, w, h, rules):
    geom = rect(77.2 + i * 0.001, 28.6, w, h)
    return {"type": "Feature", "geometry": geom, "properties": {**fp.building_properties(f"b{i}", geom, 750, rules, CFG)}}


def plan(building_id, status, area, capacity, coeff=0.8):
    return {"planId": f"p-{building_id}", "buildingId": building_id, "status": status, "roofAreaM2": area,
            "runoffCoefficient": coeff, "structure": {"capacityLitres": capacity}}


@pytest.fixture
def ward(rules):
    return [building(i, 10 + i, 12, rules) for i in range(6)]  # 120..180 m² → all required


def check_totals_add_up(out):
    per_building = sum(p["captured"] + p["lost"] for p in out["plans"]) + out["otherBuildings"]["runoff"]
    assert per_building == pytest.approx(out["totalRunoff"], abs=len(out["plans"]) + 2)
    assert sum(out["totals"].values()) == pytest.approx(out["totalRunoff"], abs=2)
    assert out["totals"]["captured"] == pytest.approx(sum(p["captured"] for p in out["plans"]), abs=len(out["plans"]) + 1)


def test_zero_plan_ward_loses_everything(ward, rules, structures):
    out = simulate(ward, {}, 100, rules, structures)
    assert out["totals"]["captured"] == 0 and out["totals"]["lostBroken"] == 0
    assert out["totals"]["lostToDrains"] == out["totalRunoff"] > 0
    assert out["plans"] == [] and out["otherBuildings"]["buildings"] == len(ward)
    assert out["ifAllRequiredHarvested"] > 0
    check_totals_add_up(out)


def test_all_verified_ward_captures_up_to_capacity(ward, rules, structures):
    cycles = structures["simulation"]["daily_cycles"]
    plans = {f["properties"]["buildingId"]: plan(f["properties"]["buildingId"], "verified", f["properties"]["areaM2"], 3000) for f in ward}
    out = simulate(ward, plans, 100, rules, structures)
    for p in out["plans"]:
        assert p["outcome"] == "captured" and p["captured"] <= 3000 * cycles
    assert out["totals"]["lostBroken"] == 0
    check_totals_add_up(out)


def test_daily_cap_applies_and_small_storm_is_fully_captured(ward, rules, structures):
    bid = ward[0]["properties"]["buildingId"]
    big = simulate(ward, {bid: plan(bid, "installed", 120, 1000)}, 200, rules, structures)
    assert big["plans"][0]["captured"] == 1000 * structures["simulation"]["daily_cycles"]
    small = simulate(ward, {bid: plan(bid, "installed", 120, 1000)}, 5, rules, structures)
    assert small["plans"][0]["lost"] == 0


def test_mixed_statuses(ward, rules, structures):
    ids = [f["properties"]["buildingId"] for f in ward]
    plans = {ids[0]: plan(ids[0], "verified", 120, 3000), ids[1]: plan(ids[1], "needs_attention", 130, 3000),
             ids[2]: plan(ids[2], "planned", 140, 3000)}
    out = simulate(ward, plans, 80, rules, structures)
    outcomes = {p["buildingId"]: p["outcome"] for p in out["plans"]}
    assert outcomes == {ids[0]: "captured", ids[1]: "broken", ids[2]: "lost"}
    assert out["totals"]["lostBroken"] == next(p["runoff"] for p in out["plans"] if p["outcome"] == "broken")
    assert out["ifAllRequiredHarvested"] >= out["totals"]["captured"]
    check_totals_add_up(out)


def test_zero_rain(ward, rules, structures):
    out = simulate(ward, {}, 0, rules, structures)
    assert out["totalRunoff"] == 0 and out["ifAllRequiredHarvested"] == 0
