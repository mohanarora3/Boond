"""POST /plans/{id}/chat (ask Boond) and GET /plans/{id}/chat (history)."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from src.common import bedrock, config
from src.common.db import get_store
from src.common.responses import ApiError, api_handler, json_body, method, ok, path_param
from src.plans import service

logger = logging.getLogger()

MAX_MESSAGE_CHARS = 1000
HISTORY_TURNS = 12
THINKING = re.compile(r"<thinking>.*?</thinking>", re.DOTALL)
RESPONSE_TAGS = re.compile(r"</?response>")
MD_LINK = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")
MD_BOLD = re.compile(r"\*\*(.+?)\*\*")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def load_history(plan_id: str) -> list[dict[str, Any]]:
    items = get_store().query(f"PLAN#{plan_id}", "CHAT#")
    return [{"role": i["role"], "text": i["text"], "at": i["at"]} for i in items]


def save_message(plan_id: str, role: str, text: str) -> None:
    at = _now()
    get_store().put({"PK": f"PLAN#{plan_id}", "SK": f"CHAT#{at}#{role[0]}", "role": role, "text": text, "at": at})


def to_strands_messages(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Last few turns as Strands/Bedrock messages: must start with a user turn and alternate roles."""
    recent = history[-HISTORY_TURNS:]
    messages: list[dict[str, Any]] = []
    for h in recent:
        if not messages and h["role"] != "user":
            continue
        if messages and messages[-1]["role"] == h["role"]:
            messages[-1]["content"][0]["text"] += "\n" + h["text"]
        else:
            messages.append({"role": h["role"], "content": [{"text": h["text"]}]})
    if messages and messages[-1]["role"] == "user":
        messages.pop()  # the new message is added by the agent call
    return messages


def clean_reply(text: str) -> str:
    text = RESPONSE_TAGS.sub("", THINKING.sub("", text))
    text = MD_LINK.sub(lambda m: f"{m.group(1)}: {m.group(2)}" if m.group(1) else m.group(2), text)
    return MD_BOLD.sub(r"\1", text).strip()


def run_agent(plan_id: str, message: str, lang: str, history: list[dict[str, Any]]) -> str:
    if bedrock.fake_ai_enabled():
        plan = service.get_plan(plan_id)
        return (f"[offline test mode] Your roof can collect about {plan['litresPerYear']:,} litres a year. "
                f"You asked: “{message}”. Enable Bedrock to get real answers.")

    from strands import Agent
    from strands.models import BedrockModel

    from src.agent.prompts import system_prompt
    from src.agent.tools import make_tools

    model = BedrockModel(model_id=bedrock.text_model_id(), region_name=bedrock.region(), temperature=0.0, max_tokens=700)
    agent = Agent(
        model=model,
        system_prompt=system_prompt(lang, config.rules()["authority_name"]),
        tools=make_tools(plan_id),
        messages=to_strands_messages(history),
        callback_handler=None,
    )
    try:
        result = agent(message)
    except Exception as exc:
        bedrock.raise_if_unavailable(exc)
        raise
    return clean_reply(str(result))


@api_handler
def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    plan_id = path_param(event, "id")
    if not plan_id:
        raise ApiError("Not found", 404)
    service.load_plan(plan_id)  # 404 if the plan doesn't exist

    if method(event) == "GET":
        return ok({"messages": load_history(plan_id)})
    if method(event) != "POST":
        raise ApiError("Not found", 404)

    body = json_body(event)
    message = str(body.get("message") or "").strip()
    lang = body.get("lang") if body.get("lang") in ("en", "hi") else "en"
    if not message:
        raise ApiError("Type a question first")
    if len(message) > MAX_MESSAGE_CHARS:
        raise ApiError(f"Please keep questions under {MAX_MESSAGE_CHARS} characters")

    history = load_history(plan_id)
    reply = run_agent(plan_id, message, lang, history) or "Sorry, I couldn't answer that. Please try asking differently."
    save_message(plan_id, "user", message)
    save_message(plan_id, "assistant", reply)
    plan = service.get_plan(plan_id)  # tools may have changed it (saved changes / application)
    return ok({"reply": reply, "status": plan["status"], "planUpdatedAt": plan["updatedAt"]})
