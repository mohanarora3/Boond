import io

from src.application.pdf import lambda_handler as application_handler
from src.maintenance import vision
from src.plans.handler import lambda_handler as plans_handler
from tests.helpers import call
from tests.test_maintenance import GOOD, here, install, post, upload




def tiny_jpeg() -> bytes:
    """A real 8×8 JPEG so the certificate can embed a thumbnail."""
    try:
        from PIL import Image
    except ImportError:
        return b"\xff\xd8\xff\xe0" + b"0" * 100
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (30, 120, 200)).save(buf, "JPEG")
    return buf.getvalue()


def cert(plan_id):
    return call(application_handler, "POST", plan_id=plan_id, path=f"/plans/{plan_id}/certificate")


def verify(plan_id):
    return call(plans_handler, "GET", plan_id=plan_id, path=f"/verify/{plan_id}")


def test_certificate_needs_verified_plan(plan):
    status, body = cert(plan["planId"])
    assert status == 409 and body["error"] == "Your system needs a verified check first"


def test_certificate_for_verified_plan(plan, monkeypatch, local_env):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    post(pid, "/checks", {"photoKey": upload(pid, "check", tiny_jpeg()), **here(plan)})
    status, body = cert(pid)
    assert status == 200
    assert body["data"]["verifyUrl"].endswith(f"/verify/{pid}")
    pdf = (local_env / "files" / body["data"]["key"]).read_bytes()
    assert pdf.startswith(b"%PDF") and len(pdf) > 2000


def test_verify_page_shows_no_personal_data(plan, monkeypatch):
    pid = plan["planId"]
    install(pid)
    monkeypatch.setattr(vision, "ask_model", lambda *a: GOOD)
    post(pid, "/checks", {"photoKey": upload(pid, "check"), **here(plan)})
    status, body = verify(pid)
    data = body["data"]
    assert status == 200
    assert set(data) == {"planId", "ward", "structureType", "status", "lastCheckAt", "lastVerdict", "locationVerified", "verifiedAt"}
    assert data["status"] == "verified" and data["lastVerdict"] == "healthy" and data["locationVerified"] is True
    flat = str(data)
    for secret in (plan["address"], str(plan["lat"]), "photos/", "Inr"):
        assert secret not in flat


def test_verify_unknown_plan_is_404(local_env):
    assert verify("nope")[0] == 404
