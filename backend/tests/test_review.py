from datetime import datetime, timedelta, timezone

import pytest

from src.application.pdf import lambda_handler as application_handler
from src.plans import service
from src.review import water
from src.review.handler import lambda_handler as review_handler
from tests.helpers import PLAN_BODY, call

NOW = datetime(2026, 10, 8, 9, tzinfo=timezone.utc)
LAT, LON = PLAN_BODY["lat"], PLAN_BODY["lon"]

# A trimmed real-shape Overpass response: a named lake (way), an unnamed pond (node), a drain, and a sewage pond to skip.
OVERPASS = {"elements": [
    {"type": "way", "id": 111, "center": {"lat": LAT + 0.006, "lon": LON}, "tags": {"natural": "water", "water": "lake", "name": "Hauz Rani Lake"}},
    {"type": "node", "id": 222, "lat": LAT + 0.002, "lon": LON, "tags": {"natural": "water", "water": "pond"}},
    {"type": "way", "id": 333, "center": {"lat": LAT, "lon": LON + 0.003}, "tags": {"waterway": "drain", "name": "Kushak Nallah"}},
    {"type": "way", "id": 444, "center": {"lat": LAT + 0.001, "lon": LON}, "tags": {"natural": "water", "water": "wastewater"}},
    {"type": "way", "id": 555, "tags": {"natural": "water"}},  # no geometry → skipped
]}


def apply(plan_id):
    return call(application_handler, "POST", plan_id=plan_id, path=f"/plans/{plan_id}/application")


def review(plan_id, body):
    return call(review_handler, "POST", body, plan_id=plan_id, path=f"/plans/{plan_id}/review")


def inbox(ward=None):
    return call(review_handler, "GET", query={"ward": ward} if ward else None, path="/officer/applications")


@pytest.fixture
def filed(local_env):
    plan = service.create_plan(PLAN_BODY)
    status, body = apply(plan["planId"])
    assert status == 200 and body["data"]["status"] == "applied"
    return service.get_plan(plan["planId"])


def test_parse_overpass_sorts_and_filters():
    rows = water.parse_elements(OVERPASS, LAT, LON)
    assert [r["osmId"] for r in rows] == ["node/222", "way/111", "way/333"]
    assert rows[0]["kind"] == "pond" and rows[0]["category"] == "water_body" and 200 < rows[0]["distanceM"] < 240
    assert rows[2]["category"] == "channel" and rows[2]["name"] == "Kushak Nallah"


def test_nearby_water_caches_and_survives_outage(local_env):
    calls = []

    def fake(lat, lon):
        calls.append(1)
        return OVERPASS

    first = water.nearby_water(LAT, LON, fetch=fake, now=NOW)
    assert first["available"] and len(first["features"]) == 3
    water.nearby_water(LAT, LON, fetch=fake, now=NOW + timedelta(days=1))
    assert len(calls) == 1

    def down(*_):
        raise TimeoutError

    stale = water.nearby_water(LAT, LON, fetch=down, now=NOW + timedelta(days=30))
    assert stale["stale"] and len(stale["features"]) == 3
    assert water.nearby_water(10.0, 10.0, fetch=down, now=NOW) == {
        "available": False, "stale": True, "fetchedAt": None, "source": "OpenStreetMap", "features": []}


def test_suggestion_follows_the_site(local_env, rules, structures):
    features = water.parse_elements(OVERPASS, LAT, LON)
    pit = service.create_plan(PLAN_BODY)
    assert water.suggest_destination(pit, features)["type"] == "onsite_recharge"
    unsafe = service.create_plan({**PLAN_BODY, "waterloggingArea": "yes"})
    s = water.suggest_destination(unsafe, features)
    assert s["type"] == "water_body" and s["osmId"] == "node/222" and s["why"] == "recharge_unsafe_waterlogging"
    tank = service.create_plan({**PLAN_BODY, "openSpace": False})
    assert water.suggest_destination(tank, [f for f in features if f["category"] == "channel"])["type"] == "storm_drain"
    assert water.suggest_destination(tank, [])["type"] == "storage_reuse"


def test_inbox_lists_only_filed_applications(filed, local_env):
    service.create_plan(PLAN_BODY)  # planned, never filed
    service.create_plan(PLAN_BODY, plan_id="demo-x", status="applied", extra={"seeded": True, "applicationKey": "applications/demo-x/20261001T000000.pdf"})
    status, body = inbox()
    rows = body["data"]["rows"]
    assert status == 200 and [r["planId"] for r in rows] == [filed["planId"]]
    row = rows[0]
    assert row["appliedAt"] and row["review"] is None and row["applicationUrl"]
    assert body["data"]["wards"] == [{"ward": "Lodhi Colony", "total": 1, "awaiting": 1}]
    assert inbox("Dwarka")[1]["data"]["rows"] == []


def test_applied_at_falls_back_to_pdf_key():
    from src.review.handler import applied_at

    assert applied_at({"applicationKey": "applications/abc/20261007T085258.pdf"}) == "2026-10-07T08:52:58+00:00"
    assert applied_at({}) is None


def test_review_approve_to_water_body(filed):
    pid = filed["planId"]
    dest = {"type": "water_body", "osmId": "way/111", "name": "Hauz Rani Lake", "kind": "lake", "distanceM": 667}
    status, body = review(pid, {"decision": "approved", "destination": dest, "note": "Overflow pipe along the lane"})
    assert status == 200
    r = body["data"]["review"]
    assert r["decision"] == "approved" and r["destination"]["name"] == "Hauz Rani Lake" and r["decidedAt"]
    assert body["data"]["status"] == "applied"  # building it is still the homeowner's next step
    # The homeowner's plan carries it.
    assert service.get_plan(pid)["review"]["destination"]["osmId"] == "way/111"
    # And it leaves the awaiting group.
    assert inbox()[1]["data"]["wards"][0]["awaiting"] == 0


def test_review_validation(filed, local_env):
    pid = filed["planId"]
    assert review(pid, {"decision": "maybe"})[0] == 400
    assert review(pid, {"decision": "approved"})[0] == 400  # needs a destination
    assert review(pid, {"decision": "approved", "destination": {"type": "water_body"}})[0] == 400  # needs the feature
    assert review(pid, {"decision": "approved", "destination": {"type": "water_body", "osmId": "way/1; drop"}})[0] == 400
    assert review(pid, {"decision": "rejected"})[0] == 400  # needs a reason
    assert review(pid, {"decision": "site_visit", "note": "Will visit Friday"})[0] == 200
    assert review(pid, {"decision": "approved", "destination": {"type": "onsite_recharge"}})[0] == 200
    assert len(service.load_plan(pid)["reviewHistory"]) == 2
    unfiled = service.create_plan(PLAN_BODY)
    assert review(unfiled["planId"], {"decision": "approved", "destination": {"type": "onsite_recharge"}})[0] == 409
    assert review("nope", {"decision": "approved"})[0] == 404


def test_nearby_endpoint(filed, monkeypatch):
    monkeypatch.setattr(water, "fetch_overpass", lambda lat, lon: OVERPASS)
    status, body = call(review_handler, "GET", plan_id=filed["planId"], path=f"/plans/{filed['planId']}/nearby-water")
    assert status == 200 and len(body["data"]["features"]) == 3
    assert body["data"]["suggestion"]["type"] == "onsite_recharge"


def test_dashboard_counts_follow_officer_decisions(filed, local_env):
    from src.dashboard.handler import lambda_handler as dashboard_handler

    def dash():
        return call(dashboard_handler, "GET", query={"ward": "Lodhi Colony"}, path="/dashboard")[1]["data"]

    apps = dash()["selected"]["applications"]
    assert (apps["filed"], apps["awaiting"], apps["approved"]) == (1, 1, 0)
    review(filed["planId"], {"decision": "approved", "destination": {"type": "storm_drain", "osmId": "way/333", "name": "Kushak Nallah"}})
    data = dash()
    apps = data["selected"]["applications"]
    assert (apps["awaiting"], apps["approved"]) == (0, 1)
    assert apps["approvedLitres"] == filed["litresPerYear"]
    assert apps["destinations"]["storm_drain"] == {"plans": 1, "litres": filed["litresPerYear"]}
    assert data["wards"][0]["applications"]["approved"] == 1
    point = next(p for p in data["points"] if p["planId"] == filed["planId"])
    assert point["review"] == "approved" and point["filed"] is True
