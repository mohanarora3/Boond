"""Validation of plan inputs from the API (and agent). Raises ApiError with a user-safe message."""
from __future__ import annotations

from typing import Any

from src.common.responses import ApiError

INPUT_FIELDS = (
    "address", "lat", "lon", "ward", "roofPolygon", "roofAreaM2", "plotAreaM2",
    "residents", "openSpace", "roofType", "monthlyWaterBill", "tankersPerYear",
    "buildingId", "contaminationSourceNearby", "waterloggingArea", "pitNearFoundation",
)
SAFETY_FIELDS = ("contaminationSourceNearby", "waterloggingArea", "pitNearFoundation")
SAFETY_ANSWERS = ("yes", "no", "not_sure")
REQUIRED = ("address", "lat", "lon", "roofAreaM2", "plotAreaM2", "residents", "openSpace")


def _number(body: dict[str, Any], name: str, lo: float, hi: float) -> float:
    value = body[name]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(f"{name} must be a number")
    if not lo <= value <= hi:
        raise ApiError(f"{name} must be between {lo:g} and {hi:g}")
    return float(value)


def _polygon(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("type") not in ("Polygon", "Feature"):
        raise ApiError("roofPolygon must be a GeoJSON Polygon or Feature")
    return value


def validate_inputs(body: dict[str, Any], rules: dict[str, Any], partial: bool = False) -> dict[str, Any]:
    """Returns only known, validated fields. With partial=True, required fields may be absent."""
    if not partial:
        missing = [f for f in REQUIRED if body.get(f) is None]
        if missing:
            raise ApiError(f"Missing fields: {', '.join(missing)}")

    out: dict[str, Any] = {}
    present = {k for k in INPUT_FIELDS if k in body and body[k] is not None}

    if "address" in present:
        if not isinstance(body["address"], str) or not body["address"].strip():
            raise ApiError("address must be a non-empty string")
        out["address"] = body["address"].strip()[:300]
    if "ward" in present:
        out["ward"] = str(body["ward"]).strip()[:80] or "Unassigned"
    if "lat" in present:
        out["lat"] = _number(body, "lat", -90, 90)
    if "lon" in present:
        out["lon"] = _number(body, "lon", -180, 180)
    if "roofPolygon" in present:
        out["roofPolygon"] = _polygon(body["roofPolygon"])
    if "roofAreaM2" in present:
        out["roofAreaM2"] = round(_number(body, "roofAreaM2", 1, 100_000), 1)
    if "plotAreaM2" in present:
        out["plotAreaM2"] = round(_number(body, "plotAreaM2", 1, 1_000_000), 1)
    if "residents" in present:
        out["residents"] = int(_number(body, "residents", 1, 10_000))
    if "openSpace" in present:
        if not isinstance(body["openSpace"], bool):
            raise ApiError("openSpace must be true or false")
        out["openSpace"] = body["openSpace"]
    if "roofType" in present:
        if body["roofType"] not in rules["runoff_coefficients"]:
            raise ApiError(f"roofType must be one of: {', '.join(rules['runoff_coefficients'])}")
        out["roofType"] = body["roofType"]
    if "monthlyWaterBill" in present:
        out["monthlyWaterBill"] = _number(body, "monthlyWaterBill", 0, 10_000_000)
    if "tankersPerYear" in present:
        out["tankersPerYear"] = _number(body, "tankersPerYear", 0, 10_000)
    if "buildingId" in present:
        value = body["buildingId"]
        if not isinstance(value, str) or not value.strip() or len(value) > 64:
            raise ApiError("buildingId must be a string of up to 64 characters")
        out["buildingId"] = value.strip()
    for field in SAFETY_FIELDS:
        if field in present:
            if body[field] not in SAFETY_ANSWERS:
                raise ApiError(f"{field} must be one of: {', '.join(SAFETY_ANSWERS)}")
            out[field] = body[field]
    return out
