"""Speech to text for voice questions on the site and voice messages in Telegram.

Whisper through Groq (free tier, understands Russian, Kazakh and English) or OpenAI when only that key is set.
The audio is sent once for transcription and is not stored.
"""
from __future__ import annotations

from typing import Optional

import httpx

from .config import Settings, settings as default_settings

MAX_BYTES = 10 * 1024 * 1024  # ≈ 10 minutes of a voice note; a question is seconds
AUDIO_EXT = {".ogg", ".oga", ".opus", ".webm", ".mp3", ".m4a", ".mp4", ".wav", ".mpeg", ".mpga"}
WHISPER_LANG = {"ru": "ru", "kk": "kk", "en": "en"}


class VoiceError(Exception):
    """A message that is safe to show to the user."""


def available(cfg: Settings | None = None) -> bool:
    cfg = cfg or default_settings
    return bool(cfg.groq_api_key or cfg.openai_api_key)


def transcribe(data: bytes, filename: str = "voice.ogg", lang: Optional[str] = None, cfg: Settings | None = None) -> str:
    cfg = cfg or default_settings
    if not data:
        raise VoiceError("Пустая запись — попробуйте ещё раз.")
    if len(data) > MAX_BYTES:
        raise VoiceError("Запись слишком длинная — задайте вопрос короче (до пары минут).")
    if cfg.groq_api_key:
        url, key, model = "https://api.groq.com/openai/v1/audio/transcriptions", cfg.groq_api_key, "whisper-large-v3-turbo"
    elif cfg.openai_api_key:
        url, key, model = cfg.openai_base_url.rstrip("/") + "/audio/transcriptions", cfg.openai_api_key, "whisper-1"
    else:
        raise VoiceError("Распознавание голоса не настроено на сервере (нужен GROQ_API_KEY).")
    name = filename if any(filename.lower().endswith(e) for e in AUDIO_EXT) else "voice.ogg"
    if name.lower().endswith((".oga", ".opus")):
        name = name.rsplit(".", 1)[0] + ".ogg"  # Telegram voice notes are Ogg/Opus
    form = {"model": model, "response_format": "json", "temperature": "0"}
    if lang in WHISPER_LANG:
        form["language"] = WHISPER_LANG[lang]
    try:
        r = httpx.post(url, headers={"authorization": f"Bearer {key}"}, data=form, files={"file": (name, data)}, timeout=60)
    except httpx.RequestError:
        raise VoiceError("Сервис распознавания недоступен — попробуйте позже или напишите текстом.") from None
    if r.status_code == 429:
        raise VoiceError("Лимит распознавания на сейчас исчерпан — попробуйте через минуту или напишите текстом.")
    if r.status_code >= 400:
        raise VoiceError("Не удалось распознать запись — попробуйте ещё раз или напишите текстом.")
    text = (r.json().get("text") or "").strip()
    if not text:
        raise VoiceError("Не расслышал вопрос — попробуйте сказать ещё раз.")
    return text[:2000]
