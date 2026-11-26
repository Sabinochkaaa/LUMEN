"""LLM access layer: one interface, several providers (Claude, Gemini, mock).

* Structured output: Claude — forced tool call with JSON Schema; Gemini — JSON mime type.
* Every response is validated by a Pydantic model; invalid JSON triggers a corrective retry.
* Transient errors (429/5xx/timeouts) are retried with exponential backoff.
* API keys are only sent in headers and are masked in every error message.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..config import Settings

log = logging.getLogger("lumen.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    pass


@dataclass
class Usage:
    calls: int = 0
    failures: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    log: list[dict] = field(default_factory=list)


def _mask(text: str, secrets: list[str]) -> str:
    for s in secrets:
        if s and len(s) > 6:
            text = text.replace(s, s[:4] + "…" + "*" * 6)
    return text


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def inline_refs(schema: dict) -> dict:
    """Resolve local $ref/$defs so every provider gets a flat, self-contained JSON Schema."""
    defs = schema.get("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node and node["$ref"].startswith("#/$defs/"):
                target = defs[node["$ref"].split("/")[-1]]
                merged = {**walk(target), **{k: walk(v) for k, v in node.items() if k != "$ref"}}
                return merged
            return {k: walk(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(schema)


class LLMClient:
    provider = "base"

    def __init__(self, model: str, settings: Settings):
        self.model = model
        self.settings = settings
        self.usage = Usage()
        self._lock = threading.Lock()
        self.fallbacks = [m for m in settings.fallback_models(self.provider) if m != model]

    # -- to implement
    def _call(self, system: str, user: str, schema: dict, name: str) -> tuple[Any, int, int]:
        raise NotImplementedError

    def structured(self, system: str, user: str, model_cls: Type[T], name: str) -> T:
        schema = inline_refs(model_cls.model_json_schema())
        attempts = max(1, self.settings.max_retries)
        last_err = ""
        prompt = user
        for attempt in range(1, attempts + 1):
            started = time.time()
            try:
                data, tin, tout = self._call_with_backoff(system, prompt, schema, name)
                with self._lock:
                    self.usage.calls += 1
                    self.usage.tokens_in += tin
                    self.usage.tokens_out += tout
                obj = model_cls.model_validate(data)
                with self._lock:
                    self.usage.log.append({"step": name, "ok": True, "attempt": attempt,
                                           "ms": int((time.time() - started) * 1000), "tokens_in": tin,
                                           "tokens_out": tout})
                return obj
            except (ValidationError, json.JSONDecodeError, KeyError, TypeError) as e:
                last_err = str(e)[:800]
                with self._lock:
                    self.usage.failures += 1
                    self.usage.log.append({"step": name, "ok": False, "attempt": attempt, "error": "invalid_json"})
                log.warning("LLM %s: невалидный ответ (попытка %s): %s", name, attempt, last_err[:200])
                prompt = (user + "\n\nПРЕДЫДУЩИЙ ОТВЕТ НЕ ПРОШЁЛ ВАЛИДАЦИЮ СХЕМЫ:\n" + last_err +
                          "\nВерни ТОЛЬКО валидный JSON строго по схеме.")
        raise LLMError(f"Модель вернула невалидный ответ на шаге «{name}» после {attempts} попыток: {last_err[:300]}")

    def _error_text(self, resp: httpx.Response) -> str:
        """Human part of a provider error (no JSON skeleton), secrets masked."""
        try:
            data = resp.json()
            err = data.get("error", data) if isinstance(data, dict) else data
            msg = err.get("message") if isinstance(err, dict) else str(err)
        except Exception:
            msg = resp.text
        return _mask(re.sub(r"\s+", " ", str(msg or "")).strip()[:500], self._secrets())

    @staticmethod
    def _retry_delay(resp: httpx.Response, default: float) -> float:
        ra = resp.headers.get("retry-after")
        if ra and ra.replace(".", "", 1).isdigit():
            return float(ra)
        m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', resp.text)
        return float(m.group(1)) if m else default

    @staticmethod
    def _quota_exhausted(code: int, text: str) -> bool:
        low = text.lower()
        if code != 429 or not ("quota" in low or "resource_exhausted" in low or "billing" in low):
            return False
        if "limit: 0" in low or "per day" in low or "perday" in low:
            return True  # no free tier for this model, or the daily quota is spent
        return "retrydelay" not in low  # per-minute limits come with retryDelay → wait instead of switching

    def _call_with_backoff(self, system, user, schema, name):
        delay = 2.0
        tried: list[str] = []
        attempt = 0
        while True:
            try:
                return self._call(system, user, schema, name)
            except httpx.HTTPStatusError as e:
                code = e.response.status_code
                msg = self._error_text(e.response)
                quota = self._quota_exhausted(code, e.response.text)
                missing_model = code == 404
                if (quota or missing_model) and self._next_model(tried):
                    log.warning("LLM %s: модель %s недоступна (%s) — переключаюсь на %s",
                                name, tried[-1], "квота" if quota else "нет модели", self.model)
                    continue
                if code in (429, 500, 502, 503, 504, 529) and not quota and attempt < 4:
                    wait = self._retry_delay(e.response, delay)
                    log.warning("LLM %s: HTTP %s, повтор через %.0f с", name, code, wait)
                    time.sleep(min(wait, 60))
                    delay *= 2
                    attempt += 1
                    continue
                with self._lock:
                    self.usage.failures += 1
                if quota:
                    raise LLMError(
                        f"Квота модели {self.model} ({self.provider}) исчерпана или недоступна на вашем тарифе. "
                        f"Выберите модель с бесплатной квотой (LLM_MODEL) или резервные (LLM_FALLBACK_MODELS). "
                        f"Ответ провайдера: {msg[:240]}") from None
                hint = " Проверьте API-ключ." if code in (401, 403) else ""
                raise LLMError(f"Ошибка API {self.provider} (HTTP {code}): {msg}.{hint}") from None
            except (httpx.TimeoutException, httpx.TransportError) as e:
                if attempt < 3:
                    time.sleep(delay)
                    delay *= 2
                    attempt += 1
                    continue
                with self._lock:
                    self.usage.failures += 1
                raise LLMError(f"Сеть/тайм-аут при обращении к {self.provider}: {_mask(str(e), self._secrets())}") from None

    def _next_model(self, tried: list[str]) -> bool:
        """Switch to the next fallback model (shared by all threads of this client)."""
        with self._lock:
            if self.model not in tried:
                tried.append(self.model)
            for m in self.fallbacks:
                if m not in tried and m != self.model:
                    self.model = m
                    return True
            return False

    def _secrets(self) -> list[str]:
        return self.settings.secrets()


class AnthropicClient(LLMClient):
    provider = "anthropic"
    URL = "https://api.anthropic.com/v1/messages"

    def _call(self, system, user, schema, name):
        if not self.settings.anthropic_api_key:
            raise LLMError("ANTHROPIC_API_KEY не задан. Получите ключ на console.anthropic.com и добавьте в .env.")
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 16000,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "tools": [{"name": "submit_result", "description": f"Вернуть результат шага «{name}» строго по схеме.",
                       "input_schema": schema}],
            "tool_choice": {"type": "tool", "name": "submit_result"},
        }
        if self.settings.temperature:
            body["temperature"] = float(self.settings.temperature)
        headers = {"x-api-key": self.settings.anthropic_api_key, "anthropic-version": "2023-06-01",
                   "content-type": "application/json"}
        with httpx.Client(timeout=self.settings.timeout_s) as c:
            r = c.post(self.URL, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
        usage = data.get("usage", {})
        for block in data.get("content", []):
            if block.get("type") == "tool_use":
                return block["input"], usage.get("input_tokens", 0), usage.get("output_tokens", 0)
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        return _extract_json(text), usage.get("input_tokens", 0), usage.get("output_tokens", 0)


class GeminiClient(LLMClient):
    provider = "gemini"
    URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def _call(self, system, user, schema, name):
        if not self.settings.gemini_api_key:
            raise LLMError("GEMINI_API_KEY не задан. Получите бесплатный ключ на aistudio.google.com и добавьте в .env.")
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user + "\n\nJSON Schema ответа:\n" +
                                                      json.dumps(schema, ensure_ascii=False)}]}],
            "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": 16000,
                                 "temperature": float(self.settings.temperature or 0)},
        }
        headers = {"x-goog-api-key": self.settings.gemini_api_key, "content-type": "application/json"}
        with httpx.Client(timeout=self.settings.timeout_s) as c:
            r = c.post(self.URL.format(model=self.model), headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
        um = data.get("usageMetadata", {})
        cand = (data.get("candidates") or [{}])[0]
        parts = cand.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text:
            raise LLMError(f"Gemini вернул пустой ответ (finishReason={cand.get('finishReason')})")
        return _extract_json(text), um.get("promptTokenCount", 0), um.get("candidatesTokenCount", 0)


class OpenAICompatClient(LLMClient):
    """Any OpenAI-compatible Chat Completions endpoint: OpenAI, DeepSeek, local vLLM/Ollama (+ OpenRouter, Groq below)."""

    provider = "openai"
    json_mode = True

    def _key(self) -> str:
        return self.settings.openai_api_key

    def _base(self) -> str:
        return self.settings.openai_base_url

    def _call(self, system, user, schema, name):
        if not self._key():
            raise LLMError(f"Ключ для {self.provider} не задан (см. .env.example).")
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user + "\n\nВерни ТОЛЬКО JSON по схеме:\n" + json.dumps(schema, ensure_ascii=False)},
            ],
        }
        if self.json_mode:
            body["response_format"] = {"type": "json_object"}
        # 0 by default: the same document should give (almost) the same report every time
        body["temperature"] = float(self.settings.temperature or 0)
        headers = {"authorization": f"Bearer {self._key()}", "content-type": "application/json",
                   "x-title": "LUMEN Requirements Intelligence"}
        url = self._base().rstrip("/") + "/chat/completions"
        with httpx.Client(timeout=self.settings.timeout_s) as c:
            r = c.post(url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
        u = data.get("usage", {})
        text = data["choices"][0]["message"].get("content") or ""
        return _extract_json(text), u.get("prompt_tokens", 0), u.get("completion_tokens", 0)


class OpenRouterClient(OpenAICompatClient):
    provider = "openrouter"
    json_mode = False  # not every free model supports response_format; JSON is extracted from the text

    def _key(self):
        return self.settings.openrouter_api_key

    def _base(self):
        return "https://openrouter.ai/api/v1"


class GroqClient(OpenAICompatClient):
    provider = "groq"

    def _key(self):
        return self.settings.groq_api_key

    def _base(self):
        return "https://api.groq.com/openai/v1"


class ChainClient(LLMClient):
    """Primary provider first; on failure of a call, the next configured provider takes over (and stays active)."""

    def __init__(self, clients: list[LLMClient], settings: Settings):
        self.clients = clients
        self.settings = settings
        self.active = 0
        self._lock = threading.Lock()
        self.switches: list[str] = []

    @property
    def provider(self):  # type: ignore[override]
        return self.clients[self.active].provider

    @property
    def model(self):  # type: ignore[override]
        return self.clients[self.active].model

    @property
    def usage(self):  # type: ignore[override]
        u = Usage()
        for c in self.clients:
            u.calls += c.usage.calls
            u.failures += c.usage.failures
            u.tokens_in += c.usage.tokens_in
            u.tokens_out += c.usage.tokens_out
            u.log += c.usage.log
        return u

    def structured(self, system, user, model_cls, name):
        start = self.active
        last: Exception | None = None
        errors: list[str] = []
        for i in range(start, len(self.clients)):
            try:
                out = self.clients[i].structured(system, user, model_cls, name)
                with self._lock:
                    if i > self.active:
                        self.switches.append(f"{self.clients[self.active].provider}/{self.clients[self.active].model} → "
                                             f"{self.clients[i].provider}/{self.clients[i].model}")
                        self.active = i
                return out
            except LLMError as e:
                last = e
                errors.append(f"{self.clients[i].provider}: {str(e)[:180]}")
                log.warning("LLM %s: провайдер %s не справился (%s) — пробую следующий", name, self.clients[i].provider,
                            str(e)[:160])
        if len(errors) > 1:
            raise LLMError("Все провайдеры LLM отказали — " + " | ".join(errors))
        raise last or LLMError("Нет доступных провайдеров LLM")


class ClaudeCLIClient(LLMClient):
    """Claude через установленный и авторизованный Claude Code CLI (`claude -p`) — без API-ключа."""

    provider = "claude-cli"

    def _call(self, system, user, schema, name):
        import shutil
        import subprocess

        exe = shutil.which("claude")
        if not exe:
            raise LLMError("Claude Code CLI не найден (npm i -g @anthropic-ai/claude-code, затем `claude login`).")
        # The system prompt goes through stdin, not argv: on Windows `claude` is a .cmd shim, and cmd.exe breaks
        # multi-line arguments and caps the whole command line at 8191 characters.
        prompt = ("<instructions>\n" + system + "\n</instructions>\n\n" + user
                  + "\n\nВерни ТОЛЬКО один JSON-объект строго по этой JSON Schema, без пояснений и markdown:\n"
                  + json.dumps(schema, ensure_ascii=False))
        cmd = [exe, "-p", "--output-format", "json", "--model", self.model,
               "--disallowedTools", "Bash,Edit,Write,WebFetch,WebSearch,Read,Glob,Grep,Task"]
        try:
            proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                  timeout=self.settings.timeout_s * 3)
        except subprocess.TimeoutExpired:
            raise httpx.TimeoutException("claude-cli timeout") from None
        try:
            env = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise LLMError(f"Claude CLI вернул неожиданный ответ: {_mask(proc.stdout[:300] + proc.stderr[:300], self._secrets())}")
        if env.get("is_error"):
            raise LLMError(f"Claude CLI: {str(env.get('result'))[:300]}")
        u = env.get("usage", {})
        return _extract_json(env.get("result", "")), u.get("input_tokens", 0), u.get("output_tokens", 0)


class MockClient(LLMClient):
    """Deterministic offline stand-in. Responses come from a responder callback (tests) or are empty."""

    provider = "mock"

    def __init__(self, model: str, settings: Settings, responder: Callable[[str, str], Any] | None = None):
        super().__init__(model, settings)
        self.responder = responder

    def _call(self, system, user, schema, name):
        if self.responder:
            out = self.responder(name, user)
            if isinstance(out, Exception):
                raise out
            if isinstance(out, str):
                return _extract_json(out), len(user) // 4, len(out) // 4
            return out, len(user) // 4, 100
        return {}, len(user) // 4, 0


def make_chain(provider: str, model: str, settings: Settings, responder=None) -> LLMClient | None:
    """Primary client plus every other configured provider as a fallback chain."""
    primary = make_client(provider, model, settings, responder)
    if primary is None or provider in ("mock",):
        return primary
    rest = [make_client(p, settings.resolve_model(p), settings) for p in settings.chain_providers(provider)]
    rest = [c for c in rest if c is not None]
    return ChainClient([primary] + rest, settings) if rest else primary


def make_client(provider: str, model: str, settings: Settings, responder=None) -> LLMClient | None:
    if provider == "anthropic":
        return AnthropicClient(model, settings)
    if provider == "gemini":
        return GeminiClient(model, settings)
    if provider == "openai":
        return OpenAICompatClient(model, settings)
    if provider == "openrouter":
        return OpenRouterClient(model, settings)
    if provider == "groq":
        return GroqClient(model, settings)
    if provider == "claude-cli":
        return ClaudeCLIClient(model, settings)
    if provider == "mock":
        return MockClient(model, settings, responder)
    if provider == "offline":
        return None
    raise LLMError(f"Неизвестный провайдер LLM: {provider}. Допустимо: anthropic, claude-cli, gemini, openrouter, groq, openai, offline, mock.")
