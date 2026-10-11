import json

import pytest

from src.calculator import rainfall
from src.common import db
from src.plans.handler import lambda_handler

BODY = {
    "address": "12 Lodhi Road, New Delhi", "lat": 28.59, "lon": 77.22, "ward": "Lodhi Colony",
    "roofAreaM2": 120, "plotAreaM2": 150, "residents": 4, "openSpace": True, "monthlyWaterBill": 900,
}


def event(method, body=None, plan_id=None):
    return {
        "requestContext": {"http": {"method": method}},
        "pathParameters": {"id": plan_id} if plan_id else None,
        "body": json.dumps(body) if body is not None else None,
    }


@pytest.fixture(autouse=True)
def local_store(tmp_path, monkeypatch):
    db.set_store(db.LocalStore(str(tmp_path / "db.json")))
    monkeypatch.setattr(rainfall, "fetch_open_meteo", lambda *a: {"daily": {"time": ["2024-01-01"], "precipitation_sum": [700.0]}})
    yield
    db.set_store(None)


def call(*args, **kwargs):
    res = lambda_handler(event(*args, **kwargs), None)
    return res["statusCode"], json.loads(res["body"])


def test_create_get_patch_plan():
    status, body = call("POST", BODY)
    assert status == 201 and body["ok"]
    plan = body["data"]
    assert plan["rainfallMm"] == 700.0
    assert plan["status"] == "planned"
    assert "PK" not in plan

    status, body = call("GET", plan_id=plan["planId"])
    assert status == 200 and body["data"]["litresPerYear"] == plan["litresPerYear"]

    status, body = call("PATCH", {"openSpace": False}, plan_id=plan["planId"])
    assert status == 200
    assert body["data"]["structure"]["type"] == "storage_tank"


def test_missing_fields_is_400():
    status, body = call("POST", {"address": "x"})
    assert status == 400 and not body["ok"] and "Missing fields" in body["error"]


def test_bad_types_are_400():
    status, body = call("POST", {**BODY, "openSpace": "yes"})
    assert status == 400
    status, body = call("POST", {**BODY, "roofAreaM2": -5})
    assert status == 400


def test_unknown_plan_is_404():
    status, body = call("GET", plan_id="nope")
    assert status == 404 and body["error"] == "Plan not found"


def test_building_id_is_stored_and_validated():
    status, body = call("POST", {**BODY, "buildingId": "08b2a1e3-ffff-4c00-0200-abc"})
    assert status == 201 and body["data"]["buildingId"] == "08b2a1e3-ffff-4c00-0200-abc"
    plan_id = body["data"]["planId"]
    status, body = call("PATCH", {"residents": 6}, plan_id=plan_id)
    assert body["data"]["buildingId"] == "08b2a1e3-ffff-4c00-0200-abc"  # kept across recalculation
    assert call("POST", {**BODY, "buildingId": "x" * 65})[0] == 400
    assert call("POST", {**BODY, "buildingId": 12})[0] == 400


def test_plan_without_building_id_has_none():
    status, body = call("POST", BODY)
    assert body["data"]["buildingId"] is None
