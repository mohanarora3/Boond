"""GET /plans/{id}/impact — water a built system has caught since installation, from real daily rainfall.

Per day: captured = min(roof × mm × coefficient, capacity × daily_cycles); 0 on days the system was broken
(from a needs_cleaning/broken check until the next healthy one). Cached on the plan for a few hours.
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from src.common import config
from src.common.db import get_store
from src.common.responses import ApiError
from src.plans import service

logger = logging.getLogger()

BUILT = ("installed", "verified", "needs_attention")
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def _get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": "Boond/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_daily_rain(lat: float, lon: float, start: date, end: date, lag_days: int) -> dict[str, float]:
    """{YYYY-MM-DD: mm}. Archive for older days; the forecast API's past_days for the most recent ones."""
    out: dict[str, float] = {}
    common = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "daily": "precipitation_sum", "timezone": "Asia/Kolkata"}
    archive_end = min(end, date.today() - timedelta(days=lag_days))
    if start <= archive_end:
        d = _get(ARCHIVE_URL, {**common, "start_date": start.isoformat(), "end_date": archive_end.isoformat()})["daily"]
        out.update({t: v for t, v in zip(d["time"], d["precipitation_sum"]) if v is not None})
    if end > archive_end:
        past_days = min(92, (date.today() - max(start, archive_end)).days + 1)
        d = _get(FORECAST_URL, {**common, "past_days": past_days, "forecast_days": 1})["daily"]
        out.update({t: v for t, v in zip(d["time"], d["precipitation_sum"]) if v is not None and start.isoformat() <= t <= end.isoformat()})
    return out


def broken_days(checks: list[dict[str, Any]], end: date) -> set[str]:
    """Days between a failed check and the next healthy one (retakes/unclear ignored)."""
    days: set[str] = set()
    broken_from: date | None = None
    for c in sorted((c for c in checks if not c.get("retake")), key=lambda c: c["at"]):
        day = datetime.fromisoformat(c["at"]).date()
        if c["verdict"] in ("needs_cleaning", "broken") and broken_from is None:
            broken_from = day
        elif c["verdict"] == "healthy" and broken_from is not None:
            days |= {(broken_from + timedelta(days=i)).isoformat() for i in range((day - broken_from).days)}
            broken_from = None
    if broken_from is not None:
        days |= {(broken_from + timedelta(days=i)).isoformat() for i in range((end - broken_from).days + 1)}
    return days


def season_window(today: date, months: list[int]) -> tuple[date, date]:
    """This year's monsoon season if it has started, else last year's."""
    year = today.year if today.month >= months[0] else today.year - 1
    last_day = (date(year, months[-1] + 1, 1) - timedelta(days=1)) if months[-1] < 12 else date(year, 12, 31)
    return date(year, months[0], 1), last_day


def compute_impact(
    rain: dict[str, float], roof_m2: float, coefficient: float, capacity_l: float, cycles: float,
    broken: set[str], season: tuple[date, date],
) -> dict[str, Any]:
    cap = capacity_l * cycles
    daily = []
    for day in sorted(rain):
        mm = rain[day]
        litres = 0.0 if day in broken else min(roof_m2 * mm * coefficient, cap)
        daily.append({"date": day, "mm": round(mm, 1), "litres": round(litres), "broken": day in broken})
    s0, s1 = season[0].isoformat(), season[1].isoformat()
    rainy = [d for d in daily if d["mm"] >= 1]
    last_rain = rainy[-1] if rainy else None
    return {
        "totalLitres": sum(d["litres"] for d in daily),
        "seasonLitres": sum(d["litres"] for d in daily if s0 <= d["date"] <= s1),
        "season": [s0, s1],
        "lastRain": last_rain,
        "brokenDays": sum(1 for d in daily if d["broken"]),
        "series": [d for d in daily if s0 <= d["date"] <= s1],
    }


def get_impact(plan_id: str, fetch: Callable[..., dict[str, float]] | None = None, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    store = get_store()
    plan = service.load_plan(plan_id)
    if plan["status"] not in BUILT:
        raise ApiError("Register your installation first", 409)
    cfg, structures = config.structures()["impact"], config.structures()
    cache = plan.get("impactCache")
    if cache and now - datetime.fromisoformat(cache["computedAt"]) < timedelta(hours=cfg["cache_hours"]):
        return {**cache, "stale": False}

    installed = datetime.fromisoformat(plan.get("installedAt") or plan["createdAt"]).date()
    today = now.date()
    try:
        rain = (fetch or fetch_daily_rain)(plan["lat"], plan["lon"], installed, today, cfg["archive_lag_days"])
    except Exception:
        logger.exception("Impact rainfall fetch failed")
        if cache:
            return {**cache, "stale": True}
        return {"available": False, "stale": True, "computedAt": None}

    checks = store.query(f"PLAN#{plan_id}", "CHECK#")
    result = compute_impact(
        rain, plan["roofAreaM2"], plan["runoffCoefficient"], plan["structure"]["capacityLitres"],
        structures["simulation"]["daily_cycles"], broken_days(checks, today), season_window(today, cfg["season_months"]),
    )
    cache = {"available": True, "installedOn": installed.isoformat(), "computedAt": now.isoformat(timespec="seconds"), **result}
    plan["impactCache"] = cache  # stored without touching status or updatedAt
    store.put(plan)
    return {**cache, "stale": False}
