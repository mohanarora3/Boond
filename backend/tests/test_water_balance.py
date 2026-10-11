from datetime import date, timedelta

import pytest

from src.calculator import rainfall, water_balance
from src.calculator.handler import calculate

ROOF, COEFF = 100.0, 0.8


def series(days: dict[str, float], start=date(2024, 1, 1), n=366):
    dates = [(start + timedelta(days=i)).isoformat() for i in range(n)]
    return {"dates": dates, "mm": [days.get(d, 0.0) for d in dates]}


def tank(capacity, each=None):
    return {"type": "storage_tank", "count": 1, "capacityLitres": capacity, "dimensions": {"litresEach": each or capacity}}


def pit(capacity):
    return {"type": "recharge_pit", "count": 1, "capacityLitres": capacity, "dimensions": {}}


def test_a_full_tank_overflows(structures):
    # 50 mm on one day = 4,000 L into a 2,000 L tank: 2,000 L lost at once.
    out = water_balance.simulate(series({"2024-07-10": 50.0}), ROOF, COEFF, tank(2000), 4, structures)
    use = 4 * structures["water_balance"]["use_litres_per_person_per_day"]
    assert out["rainOnRoofLitres"] == 4000
    assert out["lostLitres"] == 2000
    assert out["savedLitres"] == 2000  # used up over the following days
    assert out["dailyUseLitres"] == use
    july = out["monthly"][6]
    assert july["lostLitres"] == 2000 and july["savedLitres"] > 0


def test_tank_saves_far_less_than_the_roof_collects_in_a_burst_monsoon(structures):
    storms = {f"2024-07-{d:02d}": 40.0 for d in range(1, 31, 3)} | {f"2024-08-{d:02d}": 40.0 for d in range(1, 31, 3)}
    out = water_balance.simulate(series(storms), ROOF, COEFF, tank(2000), 4, structures)
    assert out["savedShare"] < 0.5
    assert out["savedLitres"] + out["lostLitres"] == pytest.approx(out["rainOnRoofLitres"], abs=2000)  # what's left in the tank


def test_pit_respects_capacity_times_cycles(structures):
    cycles = structures["simulation"]["daily_cycles"]
    out = water_balance.simulate(series({"2024-07-10": 100.0}), ROOF, COEFF, pit(1000), 4, structures)
    assert out["savedLitres"] == 1000 * cycles
    assert out["lostLitres"] == 8000 - 1000 * cycles
    assert out["kind"] == "recharge" and out["upgrade"] is None


def test_dry_and_wet_years_and_period_total(structures):
    two_years = series({"2023-07-01": 10.0, "2024-07-01": 30.0}, start=date(2023, 1, 1), n=731)
    out = water_balance.simulate(two_years, ROOF, COEFF, pit(5000), 4, structures)
    assert out["yearsSimulated"] == 2 and out["dryYear"]["year"] == 2023 and out["wetYear"]["year"] == 2024
    assert out["periodSavedLitres"] == 800 + 2400
    assert out["savedLitres"] == 1600


def test_bigger_tank_suggestion(structures):
    storms = {f"2024-07-{d:02d}": 30.0 for d in range(1, 31, 2)}
    out = water_balance.simulate(series(storms), ROOF, COEFF, tank(2000), 6, structures)
    up = out["upgrade"]
    assert up["litresEach"] == 3000 and up["extraSavedLitres"] > 0 and up["extraCostInr"] == 22000 - 16000


def test_no_daily_rain_means_no_water_block(rules, structures):
    plan = calculate({"roofAreaM2": 100, "plotAreaM2": 150, "residents": 4, "openSpace": False}, 700, rules, structures)
    assert plan["water"] is None and plan["money"]["tankWaterValueInr"] == 0


def test_tank_water_is_valued_in_money(rules, structures):
    daily = series({f"2024-07-{d:02d}": 20.0 for d in range(1, 31, 4)})
    plan = calculate({"roofAreaM2": 100, "plotAreaM2": 150, "residents": 4, "openSpace": False, "monthlyWaterBill": 0},
                     700, rules, structures, daily)
    price = structures["water_balance"]["water_price_inr_per_kl"]
    assert plan["water"]["kind"] == "use"
    assert plan["money"]["tankWaterValueInr"] == round(plan["water"]["savedLitres"] / 1000 * price)
    assert plan["money"]["annualBenefitInr"] == plan["money"]["tankWaterValueInr"]


def test_rainfall_record_caches_daily_and_upgrades_old_cache(rules):
    from src.common.db import LocalStore

    calls = []

    def fake(lat, lon, start, end):
        calls.append(1)
        return {"daily": {"time": ["2024-07-01", "2024-07-02"], "precipitation_sum": [10.0, None]}}

    import tempfile, os
    store = LocalStore(os.path.join(tempfile.mkdtemp(), "db.json"))
    store.put({"PK": rainfall.cache_key(28.6, 77.2), "SK": "META", "annualMm": 700})  # old cache: no daily
    mm, source, daily = rainfall.get_rainfall_record(28.6, 77.2, rules, store, fetch=fake)
    assert source == "open-meteo" and daily == {"dates": ["2024-07-01", "2024-07-02"], "mm": [10.0, 0.0]}
    mm, source, daily = rainfall.get_rainfall_record(28.6, 77.2, rules, store, fetch=fake)
    assert source == "cache" and daily["mm"] == [10.0, 0.0] and len(calls) == 1


def test_api_plan_has_water_block(local_env, monkeypatch):
    from src.plans import service
    from tests.helpers import PLAN_BODY

    monkeypatch.setattr(rainfall, "fetch_open_meteo",
                        lambda *a: {"daily": {"time": ["2024-07-01", "2024-07-02"], "precipitation_sum": [30.0, 5.0]}})
    plan = service.create_plan(PLAN_BODY)
    assert plan["water"]["kind"] == "recharge" and plan["water"]["rainOnRoofLitres"] == round(120 * 35 * 0.8)
    again = service.update_plan(plan["planId"], {"residents": 5})
    assert again["water"] is not None


def test_old_plan_gets_water_block_when_opened(local_env, monkeypatch):
    from src.common.db import get_store
    from src.plans import service
    from tests.helpers import PLAN_BODY

    plan = service.create_plan(PLAN_BODY)
    item = service.load_plan(plan["planId"])
    item.pop("water")
    get_store().put(item)  # as stored before this feature
    monkeypatch.setattr(rainfall, "fetch_open_meteo",
                        lambda *a: {"daily": {"time": ["2024-07-01"], "precipitation_sum": [20.0]}})
    get_store().put({"PK": rainfall.cache_key(PLAN_BODY["lat"], PLAN_BODY["lon"]), "SK": "META", "annualMm": 700})
    opened = service.get_plan(plan["planId"])
    assert opened["water"]["rainOnRoofLitres"] == round(120 * 20 * 0.8)
    assert "water" in service.load_plan(plan["planId"])
