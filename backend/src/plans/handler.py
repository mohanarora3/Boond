"""POST /plans, GET /plans/{id}, PATCH /plans/{id}, GET /plans/{id}/impact, GET /verify/{id}."""
from __future__ import annotations

from typing import Any

from src.common.responses import ApiError, api_handler, json_body, method, ok, path_param
from src.plans import service


def public_status(plan_id: str) -> dict[str, Any]:
    """What anyone scanning the certificate QR may see: no address, coordinates, photos or money."""
    from src.application.certificate import latest_check

    plan = service.load_plan(plan_id)
    check = latest_check(plan_id) or {}
    return {
        "planId": plan["planId"],
        "ward": plan.get("ward"),
        "structureType": plan["structure"]["type"],
        "status": plan["status"],
        "lastCheckAt": plan.get("lastCheckAt") or check.get("at"),
        "lastVerdict": check.get("verdict"),
        "locationVerified": bool(plan.get("lastCheckLocationVerified", check.get("locationVerified", False))),
        "verifiedAt": plan.get("verifiedAt"),
    }


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    verb = method(event)
    plan_id = path_param(event, "id")
    path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path", "")

    if verb == "GET" and plan_id and path.startswith("/verify/"):
        return ok(public_status(plan_id))
    if verb == "GET" and plan_id and path.endswith("/impact"):
        from src.plans import impact

        return ok(impact.get_impact(plan_id))
    if verb == "POST" and not plan_id:
        return ok(service.create_plan(json_body(event)), 201)
    if verb == "GET" and plan_id:
        return ok(service.get_plan(plan_id))
    if verb == "PATCH" and plan_id:
        return ok(service.update_plan(plan_id, json_body(event)))
    raise ApiError("Not found", 404)
