"""Application summary + document checklist as a PDF (reportlab), and the POST /plans/{id}/application endpoint."""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from src.common import config, s3
from src.common.responses import ApiError, api_handler, method, ok, path_param
from src.plans import service

STRUCTURE_NAMES = {
    "recharge_pit": "Recharge pit",
    "recharge_trench": "Recharge trench",
    "storage_tank": "Storage tank",
}


def _rs(n: float) -> str:
    # Built-in PDF fonts have no rupee glyph.
    return f"Rs. {n:,.0f}"


def _structure_size(s: dict[str, Any]) -> str:
    d = s["dimensions"]
    if s["type"] == "storage_tank":
        return f"{s['count']} x {d['litresEach']:,} litres"
    return f"{s['count']} x {d['lengthM']} m x {d['widthM']} m x {d['depthM']} m deep"


def build_application_pdf(plan: dict[str, Any], rules: dict[str, Any], generated_at: datetime | None = None) -> bytes:
    generated_at = generated_at or datetime.now(timezone.utc)
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=18, spaceAfter=2 * mm, textColor=colors.HexColor("#0c4a6e"))
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, spaceBefore=5 * mm, spaceAfter=2 * mm, textColor=colors.HexColor("#0c4a6e"))
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=10, leading=14)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=11, textColor=colors.HexColor("#475569"))

    def table(rows: list[list[str]], col_widths: tuple[float, float] = (60 * mm, 110 * mm)) -> Table:
        t = Table([[Paragraph(a, body), Paragraph(b, body)] for a, b in rows], colWidths=col_widths)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        return t

    s, m = plan["structure"], plan["money"]
    story: list[Any] = [
        Paragraph("Rooftop Rainwater Harvesting — Application Summary", h1),
        Paragraph(
            f"Prepared with Boond on {generated_at:%d %b %Y} · Plan ID {plan['planId']} · "
            f"For submission to {rules['authority_name']}", small),
        Paragraph("Applicant (fill in by hand)", h2),
        table([["Name", ""], ["Phone", ""], ["Email", ""], ["DJB consumer number", ""], ["Signature & date", ""]]),
        Paragraph("Property", h2),
        table([
            ["Address", plan["address"]],
            ["Ward / locality", plan.get("ward") or "—"],
            ["Location (lat, lon)", f"{plan['lat']:.5f}, {plan['lon']:.5f}"],
            ["Plot area", f"{plan['plotAreaM2']:,.0f} sq m"],
            ["Roof area", f"{plan['roofAreaM2']:,.0f} sq m ({plan.get('roofType', 'rcc').upper()})"],
            ["Residents", str(plan["residents"])],
            ["Rainwater harvesting mandatory?",
             f"{'Yes' if plan['mandatory'] else 'No'} (threshold: plot of {rules['mandatory_min_plot_m2']} sq m or more)"],
        ]),
        Paragraph("Proposed system", h2),
        table([
            ["Structure", STRUCTURE_NAMES.get(s["type"], s["type"])],
            ["Size", _structure_size(s)],
            ["Holds per design storm", f"{s['capacityLitres']:,} litres"],
            ["First-flush filter", "Included"],
            ["Average annual rainfall", f"{plan['rainfallMm']:,.0f} mm"],
            ["Water harvested per year", f"{plan['litresPerYear']:,} litres (about {plan['tankersEquivalent']} tankers)"],
        ]),
        Paragraph("Cost and assistance (estimate)", h2),
        table([
            ["Estimated installation cost", _rs(m["installCostInr"])],
            ["Financial assistance requested",
             f"{_rs(m['subsidyInr'])} (up to {rules['assistance_fraction']:.0%} of cost, max {_rs(rules['max_assistance_inr'])})"],
            ["Owner's share", _rs(m["netCostInr"])],
            ["Expected water-bill rebate", f"{_rs(m['annualRebateInr'])} per year (up to {rules['rebate_fraction']:.0%})"],
        ]),
        Paragraph("Documents to attach", h2),
    ]
    for doc_item in rules["application_documents"]:
        story.append(Paragraph(f"[&nbsp;&nbsp;] {doc_item}", body))
    sources = rules.get("_sources", {})
    seen: dict[str, dict[str, str]] = {}
    for key, refs in sources.items():
        if not key.startswith("_"):
            for ref in refs:
                seen.setdefault(ref["url"], ref)
    if seen:
        story.append(Paragraph("Sources for the rules used", h2))
        for ref in seen.values():
            story.append(Paragraph(f"{ref['title']} ({ref['date']}) — {ref['url']}", small))
    story += [
        Spacer(1, 6 * mm),
        Paragraph(
            "These figures are estimates generated by Boond from public rainfall data and configurable rules. "
            f"Amounts, eligibility and the application procedure must be confirmed with {rules['authority_name']}. "
            "Boond is not an official government system and does not submit this application on your behalf.", small),
    ]

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                      title="Rainwater Harvesting Application Summary", author="Boond").build(story)
    return buf.getvalue()


def generate_application(plan_id: str) -> dict[str, Any]:
    """Creates the PDF, stores it, marks a 'planned' plan as 'applied', returns a download URL."""
    plan = service.get_plan(plan_id)
    pdf = build_application_pdf(plan, config.rules())
    key = f"applications/{plan_id}/{datetime.now(timezone.utc):%Y%m%dT%H%M%S}.pdf"
    s3.put_bytes(key, pdf, "application/pdf")
    if plan["status"] == "planned":
        plan = service.set_status(plan_id, "applied", applicationKey=key, appliedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    return {"url": s3.presign_get(key, f"boond-application-{plan_id}.pdf"), "key": key, "status": plan["status"]}


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    plan_id = path_param(event, "id")
    if method(event) != "POST" or not plan_id:
        raise ApiError("Not found", 404)
    path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path", "")
    if path.endswith("/certificate"):
        from src.application.certificate import generate_certificate

        return ok(generate_certificate(plan_id))
    return ok(generate_application(plan_id))
