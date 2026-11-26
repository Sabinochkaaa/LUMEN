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
