from botocore.exceptions import ClientError

from src.agent import handler as agent
from src.agent.tools import explain, make_tools
from src.application.pdf import lambda_handler as application_handler
from src.common import bedrock
from tests.helpers import call


def test_history_starts_with_user_and_alternates():
    history = [
        {"role": "assistant", "text": "hi"},
        {"role": "user", "text": "a"},
        {"role": "user", "text": "b"},
        {"role": "assistant", "text": "c"},
        {"role": "user", "text": "dangling"},
    ]
    msgs = agent.to_strands_messages(history)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"][0]["text"] == "a\nb"


def test_clean_reply_strips_thinking():
    assert agent.clean_reply("<thinking>plan\nstuff</thinking> Hello") == "Hello"
    assert agent.clean_reply("<response>Hi there</response>") == "Hi there"
    assert agent.clean_reply("Get it [here](https://x.io/a.pdf) **now**") == "Get it here: https://x.io/a.pdf now"


def test_explain_rules_numbers_come_from_config(rules):
    out = explain("subsidy", rules)
    assert out["topics"]["subsidy"]["max_assistance_inr"] == rules["max_assistance_inr"]
    assert out["must_confirm_with"] == rules["authority_name"]
    assert set(explain("all", rules)["topics"]) >= {"mandatory", "rebate", "penalty", "documents"}
    assert "penalty" in explain("fine", rules)["topics"]


def test_recalculate_tool_does_not_save(plan):
    from src.plans import service

    recalc = make_tools(plan["planId"])[1]
    out = recalc(openSpace="false")  # string booleans from small models are coerced
    assert out["saved"] is False and out["after"]["structure"]["type"] == "storage_tank"
    assert service.get_plan(plan["planId"])["openSpace"] is True


def test_chat_returns_503_when_bedrock_denied(plan, monkeypatch):
    def denied(*_a, **_k):
        try:
            raise ClientError({"Error": {"Code": "AccessDeniedException", "Message": "no"}}, "ConverseStream")
        except ClientError as exc:
            bedrock.raise_if_unavailable(exc)
            raise

    monkeypatch.setattr(agent, "run_agent", denied)
    status, body = call(agent.lambda_handler, "POST", {"message": "hello", "lang": "hi"}, plan_id=plan["planId"])
    assert status == 503
    assert body["error"] == bedrock.AI_UNAVAILABLE_MESSAGE
    assert call(agent.lambda_handler, "GET", plan_id=plan["planId"])[1]["data"]["messages"] == []


def test_chat_saves_history(plan, monkeypatch):
    monkeypatch.setattr(agent, "run_agent", lambda *a: "Namaste")
    status, body = call(agent.lambda_handler, "POST", {"message": "hello"}, plan_id=plan["planId"])
    assert status == 200 and body["data"]["reply"] == "Namaste"
    msgs = call(agent.lambda_handler, "GET", plan_id=plan["planId"])[1]["data"]["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]


def test_chat_validates_message(plan):
    assert call(agent.lambda_handler, "POST", {"message": "  "}, plan_id=plan["planId"])[0] == 400
    assert call(agent.lambda_handler, "POST", {"message": "x" * 2000}, plan_id=plan["planId"])[0] == 400
    assert call(agent.lambda_handler, "POST", {"message": "hi"}, plan_id="missing")[0] == 404


def test_unknown_error_is_not_masked_as_unavailable():
    try:
        bedrock.raise_if_unavailable(ValueError("bug"))
    except bedrock.AiUnavailable:
        raise AssertionError("should not convert unrelated errors")


def test_application_pdf_and_status(plan, local_env):
    status, body = call(application_handler, "POST", plan_id=plan["planId"])
    assert status == 200 and body["data"]["status"] == "applied"
    pdf = (local_env / "files" / body["data"]["key"]).read_bytes()
    assert pdf.startswith(b"%PDF")


def test_system_prompt_renders_for_both_languages(rules):
    from src.agent.prompts import system_prompt

    for lang in ("en", "hi"):
        text = system_prompt(lang, rules["authority_name"])
        assert rules["authority_name"] in text and "openSpace=true" in text


def test_application_pdf_lists_rule_sources(rules):
    from src.application.pdf import build_application_pdf
    from src.calculator.handler import calculate
    from src.common import config

    inputs = {"roofAreaM2": 120, "plotAreaM2": 150, "residents": 4, "openSpace": True, "roofType": "rcc"}
    plan = {**inputs, "planId": "x", "address": "a", "ward": "w", "lat": 28.6, "lon": 77.2,
            **calculate(inputs, 750, rules, config.structures())}
    pdf = build_application_pdf(plan, rules)
    assert pdf.startswith(b"%PDF") and len(pdf) > 3000
    assert all(not k.startswith("_") or k == "_note" for k in rules["_sources"])
