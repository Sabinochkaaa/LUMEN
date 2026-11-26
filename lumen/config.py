"""Configuration loaded from environment / .env. Secrets never leave this module unmasked."""
from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from . import __version__

try:  # python-dotenv is optional at runtime
    from dotenv import load_dotenv

    load_dotenv(Path.cwd() / ".env", override=False)
except Exception:  # pragma: no cover
    pass

DEFAULT_MODELS = {
    "anthropic": "claude-opus-5-5",
    "claude-cli": "claude-opus-5-5",
    "gemini": "gemini-flash-latest",
    "openai": "gpt-5.5-mini",
    "openrouter": "meta-llama/llama-3.3-70b-instruct:free",
    "groq": "llama-3.3-70b-versatile",
    "mock": "mock-llm",
    "offline": "rules-only",
}
# Резервные модели при исчерпании квоты/недоступности (переопределяются LLM_FALLBACK_MODELS через запятую)
DEFAULT_FALLBACKS = {
    "gemini": ["gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemma-3-27b-it"],
    "anthropic": ["claude-sonnet-5-5", "claude-haiku-5-5"],
    "claude-cli": ["claude-sonnet-5-5"],
    "openrouter": ["deepseek/deepseek-chat-v3-0324:free", "qwen/qwen3-235b-a22b:free", "google/gemma-3-27b-it:free"],
    "groq": ["qwen/qwen3-32b", "llama-3.1-8b-instant"],
}
PROVIDER_LABELS = {
    "anthropic": "Anthropic Claude API",
    "claude-cli": "Claude Code CLI",
    "gemini": "Google Gemini API",
    "openai": "OpenAI-совместимый API",
    "openrouter": "OpenRouter",
    "groq": "Groq",
    "mock": "Mock LLM (тесты/демо)",
    "offline": "Без LLM (только детерминированные правила)",
}


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Settings:
    provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "auto").lower())
    model: str = field(default_factory=lambda: _env("LLM_MODEL"))
    anthropic_api_key: str = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    openai_base_url: str = field(default_factory=lambda: _env("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    openrouter_api_key: str = field(default_factory=lambda: _env("OPENROUTER_API_KEY"))
    groq_api_key: str = field(default_factory=lambda: _env("GROQ_API_KEY"))
    provider_chain: bool = field(default_factory=lambda: _env("LLM_PROVIDER_CHAIN", "1") != "0")
    concurrency: int = field(default_factory=lambda: int(_env("LUMEN_CONCURRENCY", "4") or 4))
    verify: bool = field(default_factory=lambda: _env("LUMEN_VERIFY", "1") != "0")
    api_token: str = field(default_factory=lambda: _env("LUMEN_API_TOKEN"))
    public_url: str = field(default_factory=lambda: _env("LUMEN_PUBLIC_URL"))
    env: str = field(default_factory=lambda: _env("APP_ENV", "development").lower())
    admin_password_raw: str = field(default_factory=lambda: _env("LUMEN_ADMIN_PASSWORD"))
    public_audits: bool = field(default_factory=lambda: _env("LUMEN_PUBLIC_AUDITS", "1") != "0")

    @property
    def admin_password(self) -> str:
        """Admin password; falls back to LUMEN_API_TOKEN so existing deployments keep working."""
        return self.admin_password_raw or self.api_token
    encryption_key: str = field(default_factory=lambda: _env("LUMEN_ENCRYPTION_KEY"))
    private_mode: bool = field(default_factory=lambda: _env("LUMEN_PRIVATE", "0") == "1")
    public_demo: bool = field(default_factory=lambda: _env("LUMEN_PUBLIC_DEMO", "1") != "0")
    rate_audits_per_hour: int = field(default_factory=lambda: int(_env("LUMEN_RATE_AUDITS", "20") or 20))
    rate_requests_per_min: int = field(default_factory=lambda: int(_env("LUMEN_RATE_REQUESTS", "240") or 240))
    bot_audits_per_hour: int = field(default_factory=lambda: int(_env("LUMEN_BOT_AUDITS", "10") or 10))
    bot_messages_per_hour: int = field(default_factory=lambda: int(_env("LUMEN_BOT_MESSAGES", "60") or 60))

    @property
    def production(self) -> bool:
        return self.env in ("production", "prod")
    temperature: str = field(default_factory=lambda: _env("LLM_TEMPERATURE"))
    max_retries: int = field(default_factory=lambda: int(_env("LLM_MAX_RETRIES", "3") or 3))
    timeout_s: float = field(default_factory=lambda: float(_env("LLM_TIMEOUT", "600") or 600))
    batch_size: int = field(default_factory=lambda: int(_env("LUMEN_BATCH_SIZE", "8") or 8))
    data_dir: Path = field(default_factory=lambda: Path(_env("LUMEN_DATA_DIR", "data")))
    supabase_url: str = field(default_factory=lambda: _env("SUPABASE_URL"))
    supabase_key: str = field(default_factory=lambda: _env("SUPABASE_SERVICE_KEY"))
    telegram_token: str = field(default_factory=lambda: _env("TELEGRAM_BOT_TOKEN"))
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO"))

    def resolve_provider(self, override: str | None = None) -> str:
        p = (override or self.provider or "auto").lower()
        if p in ("claude",):
            p = "anthropic"
        if p in ("deepseek",):
            p = "openai"
        if p == "auto":
            if self.anthropic_api_key:
                return "anthropic"
            if self.gemini_api_key:
                return "gemini"
            if self.openrouter_api_key:
                return "openrouter"
            if self.groq_api_key:
                return "groq"
            if self.openai_api_key:
                return "openai"
            return "offline"
        return p

    def chain_providers(self, primary: str) -> list[str]:
        """Other configured cloud providers to fall back to, in priority order."""
        if not self.provider_chain:
            return []
        keys = {"anthropic": self.anthropic_api_key, "gemini": self.gemini_api_key,
                "openrouter": self.openrouter_api_key, "groq": self.groq_api_key, "openai": self.openai_api_key}
        return [p for p in ("anthropic", "gemini", "openrouter", "groq", "openai") if p != primary and keys[p]]

    def resolve_model(self, provider: str, override: str | None = None) -> str:
        if override:
            return override
        if self.model and self.resolve_provider() == provider:
            return self.model
        return DEFAULT_MODELS.get(provider, "")

    def fallback_models(self, provider: str) -> list[str]:
        raw = _env("LLM_FALLBACK_MODELS")
        if raw:
            return [m.strip() for m in raw.split(",") if m.strip()]
        return list(DEFAULT_FALLBACKS.get(provider, []))

    def secrets(self) -> list[str]:
        return [x for x in (self.anthropic_api_key, self.gemini_api_key, self.openai_api_key,
                            self.supabase_key, self.telegram_token, self.api_token,
                            self.openrouter_api_key, self.groq_api_key, self.admin_password_raw,
                            self.encryption_key) if x]

    def available_providers(self) -> dict[str, bool]:
        return {
            "anthropic": bool(self.anthropic_api_key),
            "gemini": bool(self.gemini_api_key),
            "openai": bool(self.openai_api_key),
            "openrouter": bool(self.openrouter_api_key),
            "groq": bool(self.groq_api_key),
            "claude-cli": shutil.which("claude") is not None,
            "offline": True,
            "mock": True,
        }


def agent_version() -> dict[str, str]:
    """Version of the agent: package version + git commit (or LUMEN_COMMIT for containers)."""
    commit = _env("LUMEN_COMMIT") or _env("RAILWAY_GIT_COMMIT_SHA")
    dirty = False
    if not commit:
        try:
            root = Path(__file__).resolve().parent.parent
            commit = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"], cwd=root, capture_output=True, text=True, timeout=5
            ).stdout.strip()
            status = subprocess.run(
                ["git", "status", "--porcelain", "--", "lumen"], cwd=root, capture_output=True, text=True, timeout=5
            ).stdout.strip()
            dirty = bool(status)
        except Exception:
            commit = ""
    commit = (commit or "unknown")[:12]
    return {"version": __version__, "commit": commit + ("-dirty" if dirty else "")}


settings = Settings()
