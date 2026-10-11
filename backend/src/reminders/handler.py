"""Daily EventBridge job: remind owners of installed systems to do a pre-monsoon health check (SNS email)."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from src.common.db import get_store
from src.plans import service

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REMIND_STATUSES = ("installed", "verified")
SUBJECT = "Monsoon is coming — check your filter"


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def due_for_reminder(plan: dict[str, Any], now: datetime, after_days: float) -> bool:
    """Installed/verified, not seeded demo data, no check and no reminder within `after_days`."""
    if plan.get("status") not in REMIND_STATUSES or plan.get("seeded"):
        return False
    cutoff = now - timedelta(days=after_days)
    last_activity = _parse(plan.get("lastCheckAt")) or _parse(plan.get("installedAt")) or _parse(plan.get("createdAt"))
    last_reminder = _parse(plan.get("lastReminderAt"))
    return (last_activity is None or last_activity <= cutoff) and (last_reminder is None or last_reminder <= cutoff)


def message(plan: dict[str, Any], frontend_url: str) -> str:
    link = f"{frontend_url.rstrip('/')}/plan/{plan['planId']}/maintenance" if frontend_url else f"Plan ID {plan['planId']}"
    return (
        f"Namaste! The monsoon is coming.\n\n"
        f"Before the first heavy rain, take a quick photo of the filter or pit at:\n{plan['address']}\n\n"
        f"Boond will tell you in seconds if it needs cleaning — and give you the Boond Verified badge if it's ready:\n{link}\n\n"
        f"— Boond (estimates only; not an official Delhi Jal Board message)"
    )


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    after_days = float(os.environ.get("REMINDER_AFTER_DAYS", "30"))
    topic_arn = os.environ.get("TOPIC_ARN")
    frontend_url = os.environ.get("FRONTEND_URL", "")
    now = datetime.now(timezone.utc)

    due = [p for p in get_store().scan_plans() if due_for_reminder(p, now, after_days)]
    sent = 0
    sns = None
    for plan in due:
        try:
            if topic_arn:
                if sns is None:
                    import boto3

                    sns = boto3.client("sns")
                sns.publish(TopicArn=topic_arn, Subject=SUBJECT, Message=message(plan, frontend_url))
            else:
                logger.info("No TOPIC_ARN; would remind plan %s", plan["planId"])
            service.set_status(plan["planId"], plan["status"], lastReminderAt=now.isoformat(timespec="seconds"))
            sent += 1
        except Exception:
            logger.exception("Reminder failed for plan %s", plan["planId"])
    logger.info("Reminders: %d due, %d sent", len(due), sent)
    return {"due": len(due), "sent": sent}
