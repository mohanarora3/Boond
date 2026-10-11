"""Long-term annual rainfall for a location, from Open-Meteo's historical archive."""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Callable

from src.common.db import Store

logger = logging.getLogger()

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def history_window(today: date, years: int) -> tuple[date, date]:
    """The last `years` full calendar years before `today`."""
    return date(today.year - years, 1, 1), date(today.year - 1, 12, 31)


def annual_average_mm(dates: list[str], precip_mm: list[float | None]) -> float:
    """Average of per-year totals. Missing days count as 0; empty input raises."""
    totals: dict[str, float] = {}
    for day, value in zip(dates, precip_mm):
        year = day[:4]
        totals[year] = totals.get(year, 0.0) + (value or 0.0)
    if not totals:
        raise ValueError("No rainfall data")
    return sum(totals.values()) / len(totals)


def cache_key(lat: float, lon: float) -> str:
    return f"RAIN#{lat:.2f},{lon:.2f}"


def fetch_open_meteo(lat: float, lon: float, start: date, end: date, timeout_s: float = 10.0) -> dict[str, Any]:
    params = urllib.parse.urlencode({
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "precipitation_sum",
        "timezone": "Asia/Kolkata",
    })
    req = urllib.request.Request(f"{ARCHIVE_URL}?{params}", headers={"User-Agent": "Boond/1.0"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_rainfall_record(
    lat: float,
    lon: float,
    rules: dict[str, Any],
    store: Store | None = None,
    fetch: Callable[[float, float, date, date], dict[str, Any]] | None = None,
    today: date | None = None,
) -> tuple[float, str, dict[str, list[Any]] | None]:
    """(annual_mm, source, daily) — daily = {"dates": [...], "mm": [...]} for the last N full years, or None.

    The daily series is kept in the cache so the water-balance replay never needs a second download.
    Caches written before the daily series existed are refreshed once."""
    key = cache_key(lat, lon)
    cached = None
    if store is not None:
        try:
            cached = store.get(key, "META")
            if cached and cached.get("annualMm") and cached.get("daily"):
                return float(cached["annualMm"]), "cache", cached["daily"]
        except Exception:
            logger.exception("Rainfall cache read failed")

    try:
        start, end = history_window(today or date.today(), int(rules.get("rainfall_history_years", 10)))
        raw = (fetch or fetch_open_meteo)(lat, lon, start, end)["daily"]
        annual = round(annual_average_mm(raw["time"], raw["precipitation_sum"]), 1)
        daily = {"dates": list(raw["time"]), "mm": [round(float(v), 1) if v is not None else 0.0 for v in raw["precipitation_sum"]]}
    except Exception:
        logger.exception("Open-Meteo fetch failed; using cached or default rainfall")
        if cached and cached.get("annualMm"):
            return float(cached["annualMm"]), "cache", None
        return float(rules["default_annual_rainfall_mm"]), "default", None

    if store is not None:
        try:
            store.put({"PK": key, "SK": "META", "annualMm": annual, "daily": daily,
                       "fetchedAt": datetime.now(timezone.utc).isoformat()})
        except Exception:
            logger.exception("Rainfall cache write failed")
    return annual, "open-meteo", daily


def get_annual_rainfall(
    lat: float,
    lon: float,
    rules: dict[str, Any],
    store: Store | None = None,
    fetch: Callable[[float, float, date, date], dict[str, Any]] | None = None,
    today: date | None = None,
) -> tuple[float, str]:
    """Returns (annual_mm, source) where source is 'cache', 'open-meteo' or 'default'."""
    annual, source, _ = get_rainfall_record(lat, lon, rules, store, fetch, today)
    return annual, source
