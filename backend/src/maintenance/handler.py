"""Photo upload URLs, installation registration and AI health checks.

POST /plans/{id}/photos/upload-url  {purpose, contentType}  → {uploadUrl, key, contentType}
POST /plans/{id}/installation       {photoKey}              → plan (status installed)
POST /plans/{id}/checks             {photoKey}              → {check, retake, tip, plan}
GET  /plans/{id}/checks                                     → {checks, tips}
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from src.common import config, s3
from src.common.db import get_store
from src.common.responses import ApiError, api_handler, json_body, method, ok, path_param
from src.maintenance import vision
from src.maintenance.location import LOCATION_WARNING, capture_fields, check_location
from src.plans import service

CONTENT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
PURPOSES = ("installation", "check")
CHECKABLE = ("installed", "verified", "needs_attention")


def _now() -> str:
    # Microseconds keep CHECK# sort keys unique when checks happen within the same second.
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def upload_url(plan_id: str, body: dict[str, Any]) -> dict[str, Any]:
    purpose = body.get("purpose")
    content_type = body.get("contentType", "image/jpeg")
    if purpose not in PURPOSES:
        raise ApiError("purpose must be 'installation' or 'check'")
    if content_type not in CONTENT_TYPES:
        raise ApiError("Upload a JPEG, PNG or WebP photo")
    key = f"photos/{plan_id}/{purpose}/{uuid.uuid4().hex}.{CONTENT_TYPES[content_type]}"
    return {"uploadUrl": s3.presign_put(key, content_type), "key": key, "contentType": content_type}


def _photo_key(plan_id: str, body: dict[str, Any], purpose: str) -> str:
    key = str(body.get("photoKey") or "")
    if not key.startswith(f"photos/{plan_id}/{purpose}/") or ".." in key:
        raise ApiError("Upload the photo first")
    return key


def register_installation(plan_id: str, body: dict[str, Any]) -> dict[str, Any]:
    key = _photo_key(plan_id, body, "installation")
    if s3.get_bytes(key, config.structures()["vision"]["max_photo_bytes"] * 4) is None:
        raise ApiError("Photo not found — please upload it again")
    plan = service.load_plan(plan_id)
    already = body.get("alreadyBuilt")
    if already is not None and not isinstance(already, bool):
        raise ApiError("alreadyBuilt must be true or false")
    approved = (plan.get("review") or {}).get("decision") == "approved"
    # A new system is built only after the ward officer approves it; a system that already exists can be registered any time.
    if plan["status"] not in CHECKABLE and not approved and not already:
        raise ApiError("Your ward officer hasn't approved your application yet. You can register your system once it is approved.", 409)
    status = plan["status"] if plan["status"] in CHECKABLE else "installed"
    capture = capture_fields(body)
    location = check_location(plan, capture, datetime.now(timezone.utc), config.structures()["vision"])
    extra = {"existingSystem": True} if already and not approved else {}
    return service.set_status(plan_id, status, installPhotoKey=key, installedAt=_now(), installCapture={**capture, **location}, **extra)


def fix_tip(verdict: str, component: str) -> str | None:
    tips = config.structures()["fix_tips"].get(verdict)
    return tips.get(component, tips["unknown"]) if tips else None


def run_check(plan_id: str, body: dict[str, Any]) -> dict[str, Any]:
    plan = service.load_plan(plan_id)
    if plan["status"] not in CHECKABLE:
        raise ApiError("Register your installation first", 409)
    key = _photo_key(plan_id, body, "check")
    limits = config.structures()["vision"]
    capture = capture_fields(body)
    location = check_location(plan, capture, datetime.now(timezone.utc), limits)
    try:
        image = s3.get_bytes(key, limits["max_photo_bytes"])
    except ValueError as exc:
        raise ApiError("Photo is too large — please retake it") from exc
    if image is None:
        raise ApiError("Photo not found — please upload it again")
    try:
        result = vision.analyze_photo(image)
    except ValueError as exc:
        raise ApiError("Upload a JPEG, PNG or WebP photo") from exc

    retake = result["verdict"] == "unclear" or result["confidence"] < limits["min_confidence"]
    at = _now()
    check = {**result, "photoKey": key, "at": at, "retake": retake, **capture, **location}
    get_store().put({"PK": f"PLAN#{plan_id}", "SK": f"CHECK#{at}", **check})

    tip = None
    location_warning = False
    if retake:
        updated = service.public(plan)
    elif result["verdict"] == "healthy":
        if location["locationVerified"]:
            updated = service.set_status(plan_id, "verified", lastCheckAt=at, verifiedAt=at, lastCheckLocationVerified=True)
        else:
            # Healthy but not provably here: record it, don't verify.
            location_warning = True
            updated = service.set_status(plan_id, plan["status"], lastCheckAt=at, lastCheckLocationVerified=False)
    else:
        # A reported problem is always worth recording, wherever the photo was taken.
        tip = fix_tip(result["verdict"], result["component"])
        updated = service.set_status(plan_id, "needs_attention", lastCheckAt=at, attentionSince=plan.get("attentionSince") if plan["status"] == "needs_attention" else at,
                                     lastCheckLocationVerified=location["locationVerified"])
    return {"check": check, "retake": retake, "tip": tip, "plan": updated, "locationWarning": location_warning,
            "locationMessage": LOCATION_WARNING if location_warning else None}


def list_checks(plan_id: str) -> dict[str, Any]:
    plan = service.load_plan(plan_id)
    items = get_store().query(f"PLAN#{plan_id}", "CHECK#")
    checks = [{k: i[k] for k in ("component", "verdict", "reason", "confidence", "at", "retake", "distanceM", "locationVerified") if k in i}
              for i in items]
    return {"checks": list(reversed(checks)), "tips": config.structures()["maintenance"][plan["structure"]["type"]]}


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    plan_id = path_param(event, "id")
    path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path", "")
    if not plan_id:
        raise ApiError("Not found", 404)
    verb = method(event)
    if verb == "GET" and path.endswith("/checks"):
        return ok(list_checks(plan_id))
    if verb != "POST":
        raise ApiError("Not found", 404)
    service.load_plan(plan_id)
    if path.endswith("/photos/upload-url"):
        return ok(upload_url(plan_id, json_body(event)))
    if path.endswith("/installation"):
        return ok(register_installation(plan_id, json_body(event)))
    if path.endswith("/checks"):
        return ok(run_check(plan_id, json_body(event)))
    raise ApiError("Not found", 404)
