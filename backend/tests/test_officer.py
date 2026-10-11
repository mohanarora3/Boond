from datetime import datetime, timedelta, timezone

from src.dashboard.officer import attention_rows, compliance_gap

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def feature(bid, mandatory, lon=77.2, lat=28.6):
    return {"properties": {"buildingId": bid, "mandatory": mandatory, "centroid": [lon, lat]}}


def plan(pid, status, bid=None, since_days=None):
    p = {"planId": pid, "status": status, "ward": "Rohini", "structure": {"type": "recharge_pit"}}
    if bid:
        p["buildingId"] = bid
    if since_days is not None:
        p["attentionSince"] = (NOW - timedelta(days=since_days)).isoformat()
    return p


def test_attention_oldest_first_and_only_attention():
    plans = [plan("a", "needs_attention", since_days=3), plan("b", "verified"), plan("c", "needs_attention", since_days=40),
             plan("d", "needs_attention", since_days=12)]
    checks = {"c": {"verdict": "broken", "component": "pit", "at": "2026-04-22T00:00:00+00:00"}}
    rows = attention_rows(plans, checks, NOW)
    assert [r["planId"] for r in rows] == ["c", "d", "a"]
    assert [r["daysOpen"] for r in rows] == [40, 12, 3]
    assert rows[0]["lastVerdict"] == "broken" and rows[0]["lastComponent"] == "pit"


def test_gap_arithmetic():
    features = [feature(f"r{i}", "required") for i in range(10)] + [feature(f"m{i}", "maybe") for i in range(5)]
    plans = [plan("p1", "verified", "r0"), plan("p2", "needs_attention", "r1"), plan("p3", "planned", "r2"),
             plan("p4", "verified", "m0"),  # a 'maybe' building: not part of the required gap
             plan("p5", "verified")]        # no building link
    gap = compliance_gap(features, plans)
    assert gap["required"] == 10
    assert gap["required"] == gap["withPlan"] + gap["withoutPlan"]
    assert gap["withPlan"] == 3 and gap["withoutPlan"] == 7
    assert sum(gap["byStatus"].values()) == gap["withPlan"]
    assert gap["verified"] == 1 and gap["complianceScore"] == 0.1
    assert len(gap["withoutPlanPoints"]) == 7 and len(gap["planPoints"]) == 3


def test_gap_with_no_required_buildings():
    gap = compliance_gap([feature("m", "maybe")], [])
    assert gap["required"] == 0 and gap["complianceScore"] is None
