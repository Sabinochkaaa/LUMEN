"""Provider contract tests: request shape and response parsing against stubbed HTTP (no network, no key)."""
import json

import httpx
import pytest

from lumen.config import Settings
from lumen.llm.client import AnthropicClient, GeminiClient, LLMError, OpenAICompatClient
from lumen.llm.schemas import ReqAuditResponse

PAYLOAD = {"requirements": [{"id": "REQ-001", "criteria": {"verifiable": "issue"}, "findings": []}]}


def stub(monkeypatch, handler):
    real = httpx.Client

    def factory(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real(*a, **kw)

    monkeypatch.setattr(httpx, "Client", factory)


def settings(**kw):
    s = Settings()
    for k, v in kw.items():
        setattr(s, k, v)
    return s


def test_anthropic_forced_tool_call(monkeypatch):
    seen = {}

    def handler(req: httpx.Request):
        seen["body"] = json.loads(req.content)
        seen["key"] = req.headers["x-api-key"]
        return httpx.Response(200, json={"content": [{"type": "tool_use", "name": "submit_result", "input": PAYLOAD}],
                                         "usage": {"input_tokens": 100, "output_tokens": 20}})

    stub(monkeypatch, handler)
    c = AnthropicClient("claude-opus-5-5", settings(anthropic_api_key="sk-ant-test-123456"))
    out = c.structured("sys", "user", ReqAuditResponse, "t")
    assert out.requirements[0].criteria["verifiable"] == "issue"
    b = seen["body"]
    assert b["tool_choice"] == {"type": "tool", "name": "submit_result"}
    assert b["tools"][0]["input_schema"]["type"] == "object" and "$defs" not in json.dumps(b["tools"][0]["input_schema"])
    assert seen["key"] == "sk-ant-test-123456" and c.usage.tokens_in == 100


def test_anthropic_auth_error_is_masked(monkeypatch):
    stub(monkeypatch, lambda req: httpx.Response(401, json={"error": {"message": "invalid x-api-key sk-ant-test-123456"}}))
    c = AnthropicClient("m", settings(anthropic_api_key="sk-ant-test-123456"))
    with pytest.raises(LLMError) as e:
        c.structured("s", "u", ReqAuditResponse, "t")
    assert "sk-ant-test-123456" not in str(e.value) and "401" in str(e.value)


def test_gemini_json_mode(monkeypatch):
    def handler(req):
        body = json.loads(req.content)
        assert body["generationConfig"]["responseMimeType"] == "application/json"
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(PAYLOAD)}]}}],
                                         "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 7}})

    stub(monkeypatch, handler)
    out = GeminiClient("gemini-flash-latest", settings(gemini_api_key="g-key-123456")).structured("s", "u", ReqAuditResponse, "t")
    assert out.requirements[0].id == "REQ-001"


def test_openai_compatible(monkeypatch):
    stub(monkeypatch, lambda req: httpx.Response(200, json={"choices": [{"message": {"content": "```json\n" + json.dumps(PAYLOAD) + "\n```"}}],
                                                             "usage": {"prompt_tokens": 1, "completion_tokens": 1}}))
    out = OpenAICompatClient("x", settings(openai_api_key="k-123456789")).structured("s", "u", ReqAuditResponse, "t")
    assert out.requirements


def test_missing_key_message():
    with pytest.raises(LLMError, match="ANTHROPIC_API_KEY"):
        AnthropicClient("m", settings(anthropic_api_key="")).structured("s", "u", ReqAuditResponse, "t")


def test_gemini_quota_falls_back_to_next_model(monkeypatch):
    calls = []

    def handler(req):
        model = req.url.path.split("/models/")[1].split(":")[0]
        calls.append(model)
        if model == "gemini-flash-latest":
            return httpx.Response(429, json={"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message":
                "You exceeded your current quota, please check your plan and billing details. limit: 0"}})
        if model == "gemini-flash-lite-latest":
            return httpx.Response(404, json={"error": {"message": "model not found"}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(PAYLOAD)}]}}]})

    stub(monkeypatch, handler)
    c = GeminiClient("gemini-flash-latest", settings(gemini_api_key="g-key-123456"))
    out = c.structured("s", "u", ReqAuditResponse, "t")
    assert out.requirements and calls[:3] == ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"]
    assert c.model == "gemini-2.5-flash"  # sticks to the working model for the rest of the run


def test_quota_error_is_readable(monkeypatch):
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "only-one")
    stub(monkeypatch, lambda req: httpx.Response(429, json={"error": {"message": "You exceeded your current quota, please check your plan and billing details"}}))
    c = GeminiClient("only-one", settings(gemini_api_key="g-key-123456"))
    with pytest.raises(LLMError) as e:
        c.structured("s", "u", ReqAuditResponse, "t")
    assert "Квота модели only-one" in str(e.value) and '"error"' not in str(e.value)


def test_per_minute_limit_waits_instead_of_switching(monkeypatch):
    import time as _t

    monkeypatch.setattr(_t, "sleep", lambda s: None)
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        if n["c"] == 1:
            return httpx.Response(429, json={"error": {"message": "Quota exceeded for metric requests_per_minute, limit: 10",
                                                       "details": [{"retryDelay": "7s"}]}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(PAYLOAD)}]}}]})

    stub(monkeypatch, handler)
    c = GeminiClient("gemini-flash-latest", settings(gemini_api_key="g-key-123456"))
    c.structured("s", "u", ReqAuditResponse, "t")
    assert c.model == "gemini-flash-latest" and n["c"] == 2


def test_provider_chain_switches_to_next_provider(monkeypatch):
    from lumen.llm.client import ChainClient, make_chain

    def handler(req):
        if "generativelanguage" in str(req.url):
            return httpx.Response(429, json={"error": {"message": "You exceeded your current quota, check your plan and billing. limit: 0"}})
        assert "openrouter.ai" in str(req.url)
        body = json.loads(req.content)
        assert "response_format" not in body  # free OpenRouter models: JSON is parsed from text
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(PAYLOAD)}}]})

    stub(monkeypatch, handler)
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "")
    s = settings(gemini_api_key="g-key-123456", openrouter_api_key="or-key-123456", anthropic_api_key="", groq_api_key="",
                 openai_api_key="")
    c = make_chain("gemini", "gemini-flash-latest", s)
    assert isinstance(c, ChainClient)
    out = c.structured("s", "u", ReqAuditResponse, "t")
    assert out.requirements and c.provider == "openrouter" and c.switches


def test_glossary_terms_and_clarifications(tmp_path, cfg):
    from lumen.engine.pipeline import run_audit
    from lumen.knowledge.glossary import find_terms, knowledge_block

    text = ("# Сервис\n\n## Функциональные требования\n* **F-1.** В расходы входят проведённые покупки по карте.\n"
            "* **F-2.** Возврат уменьшает расходы.\n* **F-3.** Клиент получает push-уведомление.\n")
    keys = {t.key for t in find_terms(text)}
    assert {"posted", "refund", "push"} <= keys
    assert "клиринг" in knowledge_block(text)
    p = tmp_path / "r.md"
    p.write_text(text, encoding="utf-8")
    res = run_audit(p, cfg=cfg)
    posted = [f for f in res.findings if f.rule_id == "R-TERM-posted"][0]
    assert posted.severity == "HIGH" and "проведённые покупки" in posted.quote
    assert any("авторизация или клиринг" in q.question for q in res.questions)
    # a term the document defines itself is not flagged
    p.write_text(text + "\n## Глоссарий\nВозврат — это refund продавца, включая частичный.\n", encoding="utf-8")
    assert not [f for f in run_audit(p, cfg=cfg).findings if f.rule_id == "R-TERM-refund"]
