"""Shared Bedrock helpers: model IDs from env and turning Bedrock failures into a clear, user-safe error."""
from __future__ import annotations

import logging
import os
from typing import Any

from src.common.responses import ApiError

logger = logging.getLogger()

UNAVAILABLE_CODES = {
    "AccessDeniedException",       # IAM / model access not granted / account still being verified
    "UnrecognizedClientException",
    "ResourceNotFoundException",   # model or inference profile not available in this region
    "ThrottlingException",
    "ServiceUnavailableException",
    "ModelNotReadyException",
    "ModelTimeoutException",
    "ServiceQuotaExceededException",
}

AI_UNAVAILABLE_MESSAGE = (
    "Boond's AI assistant isn't available right now. Your plan and numbers still work — please try again in a few minutes."
)


class AiUnavailable(ApiError):
    def __init__(self, message: str = AI_UNAVAILABLE_MESSAGE):
        super().__init__(message, 503)


def text_model_id() -> str:
    return os.environ.get("BEDROCK_TEXT_MODEL_ID", "us.amazon.nova-lite-v1:0")


def vision_model_id() -> str:
    return os.environ.get("BEDROCK_VISION_MODEL_ID", "us.amazon.nova-lite-v1:0")


def region() -> str:
    return os.environ.get("BEDROCK_REGION") or os.environ.get("AWS_REGION") or "us-east-1"


def fake_ai_enabled() -> bool:
    """Offline stand-in for Bedrock, honoured only by the local dev server (never in Lambda)."""
    return bool(os.environ.get("BOOND_LOCAL_DB")) and os.environ.get("BOOND_FAKE_AI") == "1"


def bedrock_error_code(exc: BaseException) -> str | None:
    """Walks the exception chain looking for a botocore error code (Strands wraps some errors)."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        response: Any = getattr(current, "response", None)
        if isinstance(response, dict) and response.get("Error", {}).get("Code"):
            return str(response["Error"]["Code"])
        name = type(current).__name__
        if name.endswith("Exception") and ("Throttl" in name or name in UNAVAILABLE_CODES):
            return name
        current = current.__cause__ or current.__context__
    return None


def raise_if_unavailable(exc: BaseException) -> None:
    """Re-raise known Bedrock availability problems as AiUnavailable (503); otherwise do nothing."""
    code = bedrock_error_code(exc)
    if code in UNAVAILABLE_CODES or (code or "").startswith("Throttl"):
        logger.error("Bedrock unavailable (%s): %s", code, exc)
        raise AiUnavailable() from exc


def bedrock_client() -> Any:
    import boto3
    from botocore.config import Config

    return boto3.client("bedrock-runtime", region_name=region(), config=Config(read_timeout=60, retries={"max_attempts": 2}))
