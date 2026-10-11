from datetime import datetime, timedelta, timezone

import pytest
from botocore.exceptions import ClientError

from src.common import bedrock, s3
from src.maintenance import handler as mh
from src.maintenance import vision
from src.plans import service
from tests.helpers import call

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100
GOOD = '{"component": "filter", "verdict": "healthy", "reason": "Mesh is clean.", "confidence": 0.9}'
DIRTY = 'Sure! {"component": "filter", "verdict": "needs_cleaning", "reason": "Leaves block the mesh.", "confidence": 0.85}'


def post(plan_id, path, body):
    return call(mh.lambda_handler, "POST", body, plan_id=plan_id, path=f"/plans/{plan_id}{path}")


def upload(plan_id, purpose, data=JPEG):
    status, body = post(plan_id, "/photos/upload-url", {"purpose": purpose, "contentType": "image/jpeg"})
    assert status == 200
    s3.put_bytes(body["data"]["key"], data, "image/jpeg")  # what the browser PUT does
    return body["data"]["key"]


def here(plan, minutes_ago=1, dlat=0.0, **extra):
    """Capture metadata for a photo taken at the plan's location (offset by dlat degrees)."""
    taken = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {"captureLat": plan["lat"] + dlat, "captureLon": plan["lon"], "captureAccuracyM": 20, "capturedAt": taken, **extra}


def install(plan_id):
    """Registers a system that already exists (no officer approval needed)."""
    status, body = post(plan_id, "/installation", {"photoKey": upload(plan_id, "installation"), "alreadyBuilt": True})
    assert status == 200 and body["data"]["status"] == "installed"


@pytest.mark.parametrize("text,expected", [
    (GOOD, "healthy"),
    (DIRTY, "needs_cleaning"),
    ('{"component": "filter|pit", "verdict": "healthy", "reason": "x", "confidence": 1}', "healthy"),
    ('{"component": "pit", "verdict": "fine", "reason": "x", "confidence": 1}', None),
    ('{"component": "pit", "verdict": "broken", "reason": "", "confidence": 1}', None),
    ('{"component": "pit", "verdict": "broken", "reason": "x", "confidence": "high"}', None),
    ("not json", None),
])
def test_parse_verdict(text, expected):
    out = vision.parse_verdict(text)
    assert (out or {}).get("verdict") == expected


def test_confidence_is_clamped():
    assert vision.parse_verdict(GOOD.replace("0.9", "7"))["confidence"] == 1.0


def test_analyze_retries_once_then_unclear():
    calls = []
    assert vision.analyze_photo(JPEG, ask=lambda *a: calls.append(1) or "garbage")["verdict"] == "unclear"
    assert len(calls) == 2
    replies = iter(["garbage", GOOD])
    assert vision.analyze_photo(JPEG, ask=lambda *a: next(replies))["verdict"] == "healthy"


def test_rejects_non_image():
    with pytest.raises(ValueError):
        vision.image_format(b"%PDF-1.4")


def test_upload_url_validation(plan):
    assert post(plan["planId"], "/photos/upload-url", {"purpose": "selfie"})[0] == 400
    assert post(plan["planId"], "/photos/upload-url", {"purpose": "check", "contentType": "image/gif"})[0] == 400


def test_check_requires_installation(plan):
    status, body = post(plan["planId"], "/checks", {"photoKey": upload(plan["planId"], "check")})
    assert status == 409


def test_photo_key_must_belong_to_plan(plan):
    install(plan["planId"])
    assert post(plan["planId"], "/checks", {"photoKey": "photos/other/check/x.jpg"})[0] == 400


def test_clogged_then_clean_flow(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)

    monkeypatch.setattr(vision, "ask_model", lambda *a: DIRTY)
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check")})
    assert status == 200
    assert body["data"]["plan"]["status"] == "needs_attention"
    assert body["data"]["tip"] and body["data"]["retake"] is False

    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check"), **here(plan)})
    assert body["data"]["plan"]["status"] == "verified" and body["data"]["tip"] is None
    assert body["data"]["check"]["locationVerified"] is True and body["data"]["check"]["distanceM"] == 0

    status, body = call(mh.lambda_handler, "GET", plan_id=pid, path=f"/plans/{pid}/checks")
    assert [c["verdict"] for c in body["data"]["checks"]][:2] == ["healthy", "needs_cleaning"]
    assert body["data"]["tips"]


def test_low_confidence_asks_for_retake_without_status_change(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD.replace("0.9", "0.4"))
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check")})
    assert body["data"]["retake"] is True
    assert service.get_plan(pid)["status"] == "installed"


def test_bedrock_denied_is_503(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)

    class FakeClient:
        def converse(self, **_):
            raise ClientError({"Error": {"Code": "AccessDeniedException", "Message": "no"}}, "Converse")

    monkeypatch.setattr(bedrock, "bedrock_client", lambda: FakeClient())
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check")})
    assert status == 503 and body["error"] == bedrock.AI_UNAVAILABLE_MESSAGE


def test_healthy_photo_2km_away_does_not_verify(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check"), **here(plan, dlat=0.018)})  # ~2 km north
    data = body["data"]
    assert status == 200 and data["locationWarning"] is True and "location" in data["locationMessage"]
    assert data["plan"]["status"] == "installed"
    assert data["check"]["locationVerified"] is False and 1900 < data["check"]["distanceM"] < 2100


def test_healthy_photo_without_location_does_not_verify(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check")})
    assert body["data"]["locationWarning"] is True and body["data"]["plan"]["status"] == "installed"


def test_stale_photo_does_not_verify(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check"), **here(plan, minutes_ago=120)})
    assert body["data"]["locationWarning"] is True and body["data"]["plan"]["status"] == "installed"


def test_accuracy_allowance_is_capped(plan, monkeypatch, structures):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    cfg = structures["vision"]
    # 300 m away with a claimed 5 km accuracy: allowance is capped, so still too far.
    far = here(plan, dlat=300 / 111_320, captureAccuracyM=5000)
    assert cfg["max_photo_distance_m"] + cfg["max_accuracy_allowance_m"] < 300
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check"), **far})
    assert body["data"]["plan"]["status"] == "installed"


def test_exif_location_is_used_when_browser_location_missing(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    ist_now = datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(tzinfo=None).isoformat(timespec="seconds")
    body = {"photoKey": upload(pid, "check"), "exifLat": plan["lat"], "exifLon": plan["lon"], "exifTakenAt": ist_now}
    status, out = post(pid, "/checks", body)
    assert out["data"]["plan"]["status"] == "verified" and out["data"]["check"]["locationSource"] == "exif"


def test_broken_verdict_without_location_still_needs_attention(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: DIRTY.replace("needs_cleaning", "broken"))
    status, body = post(pid, "/checks", {"photoKey": upload(pid, "check")})
    assert body["data"]["plan"]["status"] == "needs_attention" and body["data"]["tip"]
    assert body["data"]["locationWarning"] is False


def test_bad_capture_fields_are_400(plan):
    pid = plan["planId"]
    install(pid)
    assert post(pid, "/checks", {"photoKey": upload(pid, "check"), "captureLat": "north"})[0] == 400
    assert post(pid, "/checks", {"photoKey": upload(pid, "check"), "capturedAt": "yesterday"})[0] == 400


def test_new_build_needs_officer_approval(local_env):
    from src.application.pdf import lambda_handler as application_handler
    from src.plans import service
    from src.review.handler import lambda_handler as review_handler
    from tests.helpers import PLAN_BODY

    plan = service.create_plan(PLAN_BODY)
    pid = plan["planId"]
    assert post(pid, "/installation", {"photoKey": upload(pid, "installation")})[0] == 409  # not even applied
    call(application_handler, "POST", plan_id=pid, path=f"/plans/{pid}/application")
    assert post(pid, "/installation", {"photoKey": upload(pid, "installation")})[0] == 409  # filed, not approved

    def review(body):
        return call(review_handler, "POST", body, plan_id=pid, path=f"/plans/{pid}/review")

    review({"decision": "site_visit", "note": "Visiting Friday"})
    assert post(pid, "/installation", {"photoKey": upload(pid, "installation")})[0] == 409
    review({"decision": "approved", "destination": {"type": "onsite_recharge"}})
    status, body = post(pid, "/installation", {"photoKey": upload(pid, "installation")})
    assert status == 200 and body["data"]["status"] == "installed" and "existingSystem" not in body["data"]


def test_existing_system_skips_approval(plan):
    pid = plan["planId"]
    status, body = post(pid, "/installation", {"photoKey": upload(pid, "installation"), "alreadyBuilt": True})
    assert status == 200 and body["data"]["existingSystem"] is True
    assert post(pid, "/installation", {"photoKey": upload(pid, "installation"), "alreadyBuilt": "yes"})[0] == 400
