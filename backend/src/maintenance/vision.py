"""Photo health check with a Bedrock vision model. Always returns a validated verdict dict."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from src.common import bedrock

logger = logging.getLogger()

COMPONENTS = {"filter", "pit", "gutter", "tank", "unknown"}
VERDICTS = {"healthy", "needs_cleaning", "broken", "unclear"}
UNCLEAR: dict[str, Any] = {"component": "unknown", "verdict": "unclear", "reason": "The photo could not be assessed.", "confidence": 0.0}

PROMPT = """You inspect photos of rooftop rainwater harvesting systems in Delhi (first-flush filters, filter mesh, recharge pits, gutters/downpipes, storage tanks).

Look at the photo and judge whether this part is ready for the monsoon.
- healthy: clean mesh/inlet, no visible clogging, intact.
- needs_cleaning: leaves, silt, sludge, algae, plastic or debris blocking or covering it.
- broken: cracked, torn mesh, missing cover, disconnected or collapsed.
- unclear: not a rainwater part, too dark, blurry, or too far away to judge.

Reply with ONLY one JSON object and nothing else, with exactly these keys:
- "component": one word from: filter, pit, gutter, tank, unknown
- "verdict": one word from: healthy, needs_cleaning, broken, unclear
- "reason": one short sentence a homeowner understands
- "confidence": a number from 0 to 1

Example: {"component": "filter", "verdict": "needs_cleaning", "reason": "Dry leaves are covering the filter mesh.", "confidence": 0.85}"""

JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


def parse_verdict(text: str) -> dict[str, Any] | None:
    """Extracts and validates the JSON verdict. Returns None if it is not usable."""
    match = JSON_OBJECT.search(text or "")
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    component, verdict = str(data.get("component", "")).lower(), str(data.get("verdict", "")).lower()
    reason = data.get("reason")
    try:
        confidence = float(data.get("confidence"))
    except (TypeError, ValueError):
        return None
    if component not in COMPONENTS:
        component = "unknown"  # the verdict is what matters; don't discard it over the component label
    if verdict not in VERDICTS or not isinstance(reason, str) or not reason.strip():
        return None
    return {"component": component, "verdict": verdict, "reason": reason.strip()[:300],
            "confidence": round(min(max(confidence, 0.0), 1.0), 2)}


def image_format(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise ValueError("unsupported image")


def ask_model(image: bytes, fmt: str) -> str:
    client = bedrock.bedrock_client()
    try:
        res = client.converse(
            modelId=bedrock.vision_model_id(),
            messages=[{"role": "user", "content": [{"image": {"format": fmt, "source": {"bytes": image}}}, {"text": PROMPT}]}],
            inferenceConfig={"maxTokens": 300, "temperature": 0.0},
        )
    except Exception as exc:
        bedrock.raise_if_unavailable(exc)
        raise
    return "".join(c.get("text", "") for c in res["output"]["message"]["content"])


def analyze_photo(image: bytes, ask: Callable[[bytes, str], str] | None = None) -> dict[str, Any]:
    """One try plus one retry on an unparseable answer; then 'unclear'."""
    fmt = image_format(image)
    for attempt in (1, 2):
        text = (ask or ask_model)(image, fmt)
        verdict = parse_verdict(text)
        if verdict:
            return verdict
        logger.warning("Vision reply not valid JSON (attempt %d): %r", attempt, text[:300])
    return dict(UNCLEAR)
