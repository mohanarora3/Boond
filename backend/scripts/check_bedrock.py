"""Check Bedrock access for the Boond models: `python scripts/check_bedrock.py [photo.jpg]`.

Uses your local AWS credentials. Prints OK or the exact error for the text model, the
Strands agent (streaming), and the vision model.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.common import bedrock  # noqa: E402


def check(name: str, fn) -> bool:  # type: ignore[no-untyped-def]
    try:
        print(f"OK    {name}: {fn()}")
        return True
    except Exception as exc:  # noqa: BLE001 - this is a diagnostic script
        print(f"FAIL  {name}: {bedrock.bedrock_error_code(exc) or type(exc).__name__} — {str(exc)[:300]}")
        return False


def text() -> str:
    res = bedrock.bedrock_client().converse(
        modelId=bedrock.text_model_id(),
        messages=[{"role": "user", "content": [{"text": "Reply with the single word OK."}]}],
        inferenceConfig={"maxTokens": 5},
    )
    return res["output"]["message"]["content"][0]["text"].strip()


def agent() -> str:
    from strands import Agent
    from strands.models import BedrockModel

    model = BedrockModel(model_id=bedrock.text_model_id(), region_name=bedrock.region(), max_tokens=10)
    return str(Agent(model=model, callback_handler=None)("Reply with the single word OK.")).strip()


def vision(photo: Path) -> str:
    from src.maintenance.vision import analyze_photo

    return str(analyze_photo(photo.read_bytes()))


if __name__ == "__main__":
    print(f"region={bedrock.region()} text={bedrock.text_model_id()} vision={bedrock.vision_model_id()}")
    ok = check("text model (Converse)", text) and check("Strands agent (ConverseStream)", agent)
    if len(sys.argv) > 1:
        ok = check("vision model", lambda: vision(Path(sys.argv[1]))) and ok
    sys.exit(0 if ok else 1)
