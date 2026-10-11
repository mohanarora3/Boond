"""POST /plans/{id}/certificate — one-page "Boond Verified" certificate with photo thumbnail and QR to the public verify page."""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from typing import Any

from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from src.application.pdf import STRUCTURE_NAMES, _structure_size
from src.common import config, s3
from src.common.db import get_store
from src.common.responses import ApiError
from src.plans import service

logger = logging.getLogger()
VERDICT_LABELS = {"healthy": "Healthy", "needs_cleaning": "Needs cleaning", "broken": "Broken", "unclear": "Unclear"}


def frontend_url() -> str:
    return (os.environ.get("FRONTEND_URL") or "http://localhost:5173").rstrip("/")


def verify_url(plan_id: str) -> str:
    return f"{frontend_url()}/verify/{plan_id}"


def latest_check(plan_id: str, verdict: str | None = None) -> dict[str, Any] | None:
    checks = [c for c in get_store().query(f"PLAN#{plan_id}", "CHECK#") if not c.get("retake")]
    if verdict:
        checks = [c for c in checks if c.get("verdict") == verdict]
    return checks[-1] if checks else None


def _qr(url: str, size_mm: float = 38) -> Drawing:
    widget = QrCodeWidget(url)
    x1, y1, x2, y2 = widget.getBounds()
    side = size_mm * mm
    drawing = Drawing(side, side, transform=[side / (x2 - x1), 0, 0, side / (y2 - y1), 0, 0])
    drawing.add(widget)
    return drawing


def _thumbnail(photo_key: str | None) -> Image | None:
    if not photo_key:
        return None
    try:
        data = s3.get_bytes(photo_key, config.structures()["vision"]["max_photo_bytes"])
        if not data:
            return None
        img = Image(io.BytesIO(data))
        scale = min(70 * mm / img.imageWidth, 52 * mm / img.imageHeight)
        img.drawWidth, img.drawHeight = img.imageWidth * scale, img.imageHeight * scale
        return img
    except Exception:
        logger.exception("Certificate thumbnail failed")
        return None


def build_certificate_pdf(plan: dict[str, Any], check: dict[str, Any], rules: dict[str, Any], issued: datetime) -> bytes:
    styles = getSampleStyleSheet()
    title = ParagraphStyle("t", parent=styles["Title"], fontSize=30, leading=36, textColor=colors.HexColor("#047857"), spaceAfter=3 * mm)
    sub = ParagraphStyle("s", parent=styles["BodyText"], fontSize=12, alignment=1, textColor=colors.HexColor("#334155"))
    body = ParagraphStyle("b", parent=styles["BodyText"], fontSize=11, leading=15)
    small = ParagraphStyle("sm", parent=body, fontSize=8, leading=11, textColor=colors.HexColor("#475569"))

    verified_on = datetime.fromisoformat(check["at"]).astimezone(timezone.utc)
    s = plan["structure"]
    facts = [
        ["Ward / locality", plan.get("ward") or "—"],
        ["System", f"{STRUCTURE_NAMES.get(s['type'], s['type'])} — {_structure_size(s)}"],
        ["Verified on", f"{verified_on:%d %b %Y}"],
        ["Photo check", f"{VERDICT_LABELS.get(check['verdict'], check['verdict'])} ({check.get('component', 'system')}), "
                        f"{round(float(check.get('confidence', 0)) * 100)}% confidence"],
        ["Photo location", "Taken at the building" if check.get("locationVerified") else "Not confirmed"],
        ["Rain it can harvest", f"about {plan['litresPerYear']:,} litres a year"],
        ["Plan ID", plan["planId"]],
    ]
    table = Table([[Paragraph(a, body), Paragraph(b, body)] for a, b in facts], colWidths=(48 * mm, 122 * mm))
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0fdf4")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    photo = _thumbnail(check.get("photoKey"))
    qr_cell = [_qr(verify_url(plan["planId"])), Paragraph("Scan to check this system's current status", small)]
    proof = Table([[photo or Paragraph("Photo not available", small), qr_cell]], colWidths=(85 * mm, 85 * mm))
    proof.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (-1, -1), "CENTER")]))

    story: list[Any] = [
        Spacer(1, 10 * mm),
        Paragraph("Boond Verified", title),
        Paragraph("Rooftop rainwater harvesting system — working at its last monsoon check", sub),
        Spacer(1, 8 * mm),
        table,
        Spacer(1, 8 * mm),
        proof,
        Spacer(1, 4 * mm),
        Paragraph(verify_url(plan["planId"]), small),
        Spacer(1, 10 * mm),
        Paragraph(
            f"Issued {issued:%d %b %Y} by Boond from an AI photo check. This certificate shows the system looked healthy in a photo "
            f"at its last check; it can change. Boond is not an official {rules['authority_name']} system, and this is not a "
            f"government certificate. Confirm compliance, rebates and penalties with {rules['authority_name']}.", small),
    ]
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                      title="Boond Verified certificate", author="Boond").build(story)
    return buf.getvalue()


def generate_certificate(plan_id: str) -> dict[str, Any]:
    plan = service.get_plan(plan_id)
    if plan["status"] != "verified":
        raise ApiError("Your system needs a verified check first", 409)
    check = latest_check(plan_id, "healthy")
    if not check:
        raise ApiError("Your system needs a verified check first", 409)
    issued = datetime.now(timezone.utc)
    pdf = build_certificate_pdf(plan, check, config.rules(), issued)
    key = f"certificates/{plan_id}/{issued:%Y%m%dT%H%M%S}.pdf"
    s3.put_bytes(key, pdf, "application/pdf")
    service.set_status(plan_id, "verified", certificateKey=key)
    return {"url": s3.presign_get(key, f"boond-verified-{plan_id}.pdf"), "key": key, "verifyUrl": verify_url(plan_id)}
