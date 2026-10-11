from datetime import datetime, timedelta, timezone

from src.dashboard.handler import build_dashboard, lambda_handler as dashboard_handler
from src.plans import service
from src.reminders import handler as reminders
from tests.helpers import PLAN_BODY, call

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def iso(days_ago):
    return (NOW - timedelta(days=days_ago)).isoformat()


def test_dashboard_aggregates_by_ward():
    plans = [
        {"planId": "a", "ward": "Dwarka", "status": "verified", "litresPerYear": 100, "lat": 1, "lon": 2},
        {"planId": "b", "ward": "Dwarka", "status": "planned", "litresPerYear": 50, "lat": 1, "lon": 2},
        {"planId": "c", "ward": "Rohini", "status": "installed", "litresPerYear": 70, "lat": 1, "lon": 2},
    ]
    out = build_dashboard(plans, "Dwarka")
    assert [w["ward"] for w in out["wards"]] == ["Dwarka", "Rohini"]
    assert out["selected"]["byStatus"]["verified"] == 1 and out["selected"]["total"] == 2
    assert out["selected"]["potentialLitres"] == 150
    assert out["selected"]["harvestingLitres"] == 100 and out["selected"]["verifiedLitres"] == 100
    assert {p["planId"] for p in out["points"]} == {"a", "b"}
    assert build_dashboard(plans, None)["selected"]["total"] == 3
    assert build_dashboard(plans, "Nowhere")["selected"]["total"] == 0


def test_dashboard_endpoint(plan):
    status, body = call(dashboard_handler, "GET", query={"ward": "Lodhi Colony"})
    assert status == 200 and body["data"]["selected"]["total"] == 1


def test_due_for_reminder_rules():
    base = {"status": "installed", "createdAt": iso(100)}
    assert reminders.due_for_reminder({**base, "installedAt": iso(40)}, NOW, 30)
    assert not reminders.due_for_reminder({**base, "installedAt": iso(10)}, NOW, 30)
    assert not reminders.due_for_reminder({**base, "installedAt": iso(40), "lastCheckAt": iso(5)}, NOW, 30)
    assert not reminders.due_for_reminder({**base, "installedAt": iso(40), "lastReminderAt": iso(2)}, NOW, 30)
    assert not reminders.due_for_reminder({**base, "status": "planned"}, NOW, 30)
    assert not reminders.due_for_reminder({**base, "seeded": True}, NOW, 30)
    assert reminders.due_for_reminder({**base, "status": "verified", "lastCheckAt": iso(31)}, NOW, 30)


def test_reminder_job_publishes_and_records(local_env, monkeypatch):
    p = service.create_plan(PLAN_BODY)
    service.set_status(p["planId"], "installed", installedAt=iso(400))
    published = []

    class FakeSns:
        def publish(self, **kw):
            published.append(kw)

    import boto3
    monkeypatch.setattr(boto3, "client", lambda name: FakeSns())
    monkeypatch.setenv("TOPIC_ARN", "arn:aws:sns:us-east-1:1:t")
    monkeypatch.setenv("FRONTEND_URL", "https://boond.example")
    monkeypatch.setenv("REMINDER_AFTER_DAYS", "30")

    assert reminders.lambda_handler({}, None) == {"due": 1, "sent": 1}
    assert f"https://boond.example/plan/{p['planId']}/maintenance" in published[0]["Message"]
    assert published[0]["Subject"] == reminders.SUBJECT
    assert reminders.lambda_handler({}, None)["due"] == 0  # not reminded twice


def test_hidden_wards_are_left_out(local_env):
    service.create_plan({**PLAN_BODY, "ward": "Warm-up"})
    service.create_plan(PLAN_BODY)
    status, body = call(dashboard_handler, "GET")
    assert [w["ward"] for w in body["data"]["wards"]] == [PLAN_BODY["ward"]]
