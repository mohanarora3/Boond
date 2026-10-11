"""HTTP API (payload v2) helpers. Every response is { ok, data?, error? }."""
from __future__ import annotations

import base64
import json
import logging
from decimal import Decimal
from functools import wraps
from typing import Any, Callable

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
}


class ApiError(Exception):
    """Raised for client-facing errors; the message is safe to show to users."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Not JSON serialisable: {type(value).__name__}")


def ok(data: Any, status: int = 200) -> dict[str, Any]:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps({"ok": True, "data": data}, default=_json_default)}


def error(message: str, status: int = 400) -> dict[str, Any]:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps({"ok": False, "error": message})}


def method(event: dict[str, Any]) -> str:
    return event.get("requestContext", {}).get("http", {}).get("method", "GET").upper()


def path_param(event: dict[str, Any], name: str) -> str | None:
    return (event.get("pathParameters") or {}).get(name)


def query_param(event: dict[str, Any], name: str) -> str | None:
    return (event.get("queryStringParameters") or {}).get(name)


def json_body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError("Request body must be valid JSON") from exc
    if not isinstance(body, dict):
        raise ApiError("Request body must be a JSON object")
    return body


def api_handler(fn: Callable[[dict[str, Any], Any], dict[str, Any]]) -> Callable[[dict[str, Any], Any], dict[str, Any]]:
    """Turns ApiError into 4xx, logs anything else and returns a generic 500."""

    @wraps(fn)
    def wrapper(event: dict[str, Any], context: Any) -> dict[str, Any]:
        if method(event) == "OPTIONS":
            return {"statusCode": 204, "headers": CORS_HEADERS, "body": ""}
        try:
            return fn(event, context)
        except ApiError as exc:
            return error(exc.message, exc.status)
        except Exception:
            logger.exception("Unhandled error in %s", fn.__module__)
            return error("Something went wrong. Please try again.", 500)

    return wrapper
