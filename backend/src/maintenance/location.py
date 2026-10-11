"""Was the photo taken at the building, recently? Browser geolocation first, EXIF GPS as a fallback."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from src.common.geo import haversine_m
from src.common.responses import ApiError

IST = timezone(timedelta(hours=5, minutes=30))
CAPTURE_FIELDS = ("captureLat", "captureLon", "captureAccuracyM", "capturedAt", "exifLat", "exifLon", "exifTakenAt")
LOCATION_WARNING = "We couldn't confirm this photo was taken at your building. Turn on location and retake it."


def _num(body: dict[str, Any], key: str, lo: float, hi: float) -> float | None:
    v = body.get(key)
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise ApiError(f"{key} is not valid")
    return float(v)


def _time(body: dict[str, Any], key: str) -> datetime | None:
    v = body.get(key)
    if v is None:
        return None
    try:
        t = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ApiError(f"{key} must be an ISO date-time") from exc
    # EXIF DateTimeOriginal has no time zone; photos here are taken in India.
    return t if t.tzinfo else t.replace(tzinfo=IST)


def capture_fields(body: dict[str, Any]) -> dict[str, Any]:
    """Validated capture metadata to store with the photo (None values dropped)."""
    out = {
        "captureLat": _num(body, "captureLat", -90, 90),
        "captureLon": _num(body, "captureLon", -180, 180),
        "captureAccuracyM": _num(body, "captureAccuracyM", 0, 100_000),
        "exifLat": _num(body, "exifLat", -90, 90),
        "exifLon": _num(body, "exifLon", -180, 180),
    }
    for key in ("capturedAt", "exifTakenAt"):
        t = _time(body, key)
        out[key] = t.isoformat() if t else None
    return {k: v for k, v in out.items() if v is not None}


def check_location(plan: dict[str, Any], capture: dict[str, Any], now: datetime, cfg: dict[str, Any]) -> dict[str, Any]:
    """{distanceM, locationVerified, locationSource}. Unverified when there is no location, it is too far, or too old."""
    if capture.get("captureLat") is not None and capture.get("captureLon") is not None:
        lat, lon, source = capture["captureLat"], capture["captureLon"], "browser"
        accuracy = capture.get("captureAccuracyM") or 0.0
        taken = capture.get("capturedAt")
    elif capture.get("exifLat") is not None and capture.get("exifLon") is not None:
        lat, lon, source, accuracy = capture["exifLat"], capture["exifLon"], "exif", 0.0
        taken = capture.get("exifTakenAt") or capture.get("capturedAt")
    else:
        return {"distanceM": None, "locationVerified": False, "locationSource": None}

    distance = haversine_m(plan["lat"], plan["lon"], lat, lon)
    allowed = cfg["max_photo_distance_m"] + min(accuracy, cfg["max_accuracy_allowance_m"])
    taken_at = datetime.fromisoformat(taken) if taken else None
    recent = taken_at is not None and abs((now - taken_at).total_seconds()) <= cfg["max_capture_age_minutes"] * 60
    return {"distanceM": round(distance), "locationVerified": distance <= allowed and recent, "locationSource": source}
