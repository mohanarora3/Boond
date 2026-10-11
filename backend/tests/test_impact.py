from datetime import date, datetime, timedelta, timezone

import pytest

from src.plans import impact, service
from tests.helpers import PLAN_BODY

SEASON = (date(2026, 6, 1), date(2026, 9, 30))
NOW = datetime(2026, 8, 20, 12, tzinfo=timezone.utc)


def test_zero_rain_zero_captured():
    out = impact.compute_impact({"2026-07-01": 0.0, "2026-07-02": 0.0}, 120, 0.8, 3000, 3, set(), SEASON)
    assert out["totalLitres"] == 0 and out["lastRain"] is None


def test_daily_cap_applies():
    out = impact.compute_impact({"2026-07-01": 200.0, "2026-07-02": 10.0}, 120, 0.8, 3000, 3, set(), SEASON)
    assert out["series"][0]["litres"] == 9000            # capped at capacity × cycles
    assert out["series"][1]["litres"] == round(120 * 10 * 0.8)
    assert out["lastRain"]["date"] == "2026-07-02"


def test_broken_period_contributes_zero():
    checks = [
        {"at": "2026-07-01T10:00:00+00:00", "verdict": "needs_cleaning"},
        {"at": "2026-07-01T11:00:00+00:00", "verdict": "unclear", "retake": True},
        {"at": "2026-07-03T10:00:00+00:00", "verdict": "healthy"},
    ]
    broken = impact.broken_days(checks, date(2026, 7, 10))
    assert broken == {"2026-07-01", "2026-07-02"}
    rain = {f"2026-07-0{i}": 20.0 for i in range(1, 5)}
    out = impact.compute_impact(rain, 100, 0.8, 3000, 3, broken, SEASON)
    assert [d["litres"] for d in out["series"]] == [0, 0, 1600, 1600] and out["brokenDays"] == 2


def test_open_broken_period_runs_to_today():
    broken = impact.broken_days([{"at": "2026-08-18T09:00:00+00:00", "verdict": "broken"}], date(2026, 8, 20))
    assert broken == {"2026-08-18", "2026-08-19", "2026-08-20"}


def test_season_window():
    assert impact.season_window(date(2026, 8, 1), [6, 7, 8, 9]) == SEASON
    assert impact.season_window(date(2026, 3, 1), [6, 7, 8, 9]) == (date(2025, 6, 1), date(2025, 9, 30))


@pytest.fixture
def installed_plan(local_env):
    p = service.create_plan(PLAN_BODY)
    service.set_status(p["planId"], "installed", installedAt=(NOW - timedelta(days=30)).isoformat())
    return p


def test_impact_endpoint_caches_and_falls_back(installed_plan):
    pid = installed_plan["planId"]
    calls = []

    def fake(lat, lon, start, end, lag):
        calls.append(1)
        return {"2026-08-01": 15.0, "2026-08-02": 0.0}

    first = impact.get_impact(pid, fetch=fake, now=NOW)
    assert first["available"] and first["totalLitres"] == round(120 * 15 * 0.8) and first["stale"] is False
    impact.get_impact(pid, fetch=fake, now=NOW + timedelta(hours=1))
    assert len(calls) == 1  # served from cache

    def down(*_):
        raise TimeoutError

    later = impact.get_impact(pid, fetch=down, now=NOW + timedelta(hours=10))
    assert later["stale"] is True and later["totalLitres"] == first["totalLitres"]


def test_impact_without_cache_and_api_down_is_not_an_error(installed_plan):
    def down(*_):
        raise TimeoutError

    out = impact.get_impact(installed_plan["planId"], fetch=down, now=NOW)
    assert out == {"available": False, "stale": True, "computedAt": None}


def test_impact_needs_installation(local_env):
    from src.common.responses import ApiError

    p = service.create_plan(PLAN_BODY)
    with pytest.raises(ApiError):
        impact.get_impact(p["planId"])
