"""LÜMEN Telegram bot.

* Принимает документ требований в любом поддерживаемом формате (PDF, DOCX, MD, TXT, HTML, RTF, фото/скан через OCR)
  или просто текст требований, вставленный в чат.
* Присылает вердикт, главные дефекты и отчёт в формате, который выберет пользователь: PDF, Word, Excel, HTML, MD, JSON.
* Отвечает на вопросы по отчёту с помощью LLM («что не так с Ф-3?», «перепиши REQ-010», «пришли таблицей»).

    python -m lumen.bot            # отдельный процесс (long polling)
    LUMEN_BOT_IN_API=1 uvicorn …   # или внутри API (по умолчанию, если задан TELEGRAM_BOT_TOKEN)
"""
from __future__ import annotations

import html
import json
import logging
import re
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx

from ..config import settings
from ..llm import prompts
from ..llm.client import LLMError, make_client
from ..llm.schemas import ChatAnswer
from ..models import AuditResult
from ..parsing.loader import IMAGE_EXT, SUPPORTED
from ..report.export import render, safe_name
from ..service import AuditService

log = logging.getLogger("lumen.bot")
READY = {"READY": "✅ READY", "READY WITH CONDITIONS": "🟡 READY WITH CONDITIONS", "NOT READY": "❌ NOT READY",
         "INSUFFICIENT DATA": "⚪ INSUFFICIENT DATA"}
SEV = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}
FORMATS = {"pdf": "📕 PDF", "docx": "📘 Word", "xlsx": "📗 Excel", "html": "🌐 HTML", "md": "📝 Markdown", "json": "🧩 JSON"}
FORMAT_WORDS = [
    ("pdf", r"\bpdf\b|пдф"), ("docx", r"\bdocx?\b|word|ворд"), ("xlsx", r"xlsx?|excel|эксел|таблиц"),
    ("html", r"\bhtml\b|веб|браузер"), ("md", r"\bmd\b|markdown|маркдаун"), ("json", r"\bjson\b|джейсон"),
]
SEND_WORDS = r"пришли|скинь|отправь|дай|выгрузи|сохрани|экспорт|в формате|файл|скачать|send|export"
HELP = (
    "<b>LÜMEN Requirements Intelligence</b>\n"
    "AI-аудитор требований для банков и финтеха (ISO/IEC/IEEE 29148, IEEE 830).\n\n"
    "📎 <b>Пришлите документ требований</b>: PDF, Word, Markdown, TXT, HTML, RTF или фото/скан страницы — "
    "или просто вставьте текст требований сообщением.\n"
    "Я выделю требования, найду противоречия, пробелы и FinTech-риски, задам вопросы владельцу и пришлю отчёт.\n\n"
    "💬 Потом спрашивайте: «что не так с Ф-3?», «перепиши REQ-010», «почему NOT READY?», «пришли в Excel».\n\n"
    "/format — формат отчёта по умолчанию\n/demo — демонстрационный прогон\n/last — последний отчёт\n/help — помощь"
)


def wanted_format(text: str) -> Optional[str]:
    low = text.lower()
    for fmt, rx in FORMAT_WORDS:
        if re.search(rx, low):
            return fmt
    return None


def audit_context(r: AuditResult, limit: int = 60_000) -> str:
    """Compact, evidence-carrying view of the audit for the chat model."""
    s = r.scores
    data = {
        "документ": r.passport.document_title or r.passport.document_name,
        "готовность": r.readiness, "обоснование": r.readiness_reason, "индекс_качества": s.quality_index,
        "по_критичности": s.by_severity, "приоритеты": r.priorities,
        "требования": [{"id": x.id, "id_в_документе": x.source_id if x.source_id_kind == "explicit" else None,
                        "тип": x.type, "строки": f"{x.loc.line_start}-{x.loc.line_end}", "текст": x.quote[:400]}
                       for x in r.requirements],
        "замечания": [{"id": f.id, "критичность": f.severity, "статус": f.status, "требования": f.req_ids,
                       "заголовок": f.title, "где": f.loc.label() if f.loc else "документ в целом",
                       "цитата": f.quote[:300], "проблема": f.problem[:500], "исправление": f.fix[:300],
                       "формулировка": f.rewrite[:300]} for f in r.findings],
        "вопросы": [{"id": q.id, "статус": q.status, "требования": q.req_ids, "вопрос": q.question, "ответ": q.answer}
                    for q in r.questions],
    }
    out = json.dumps(data, ensure_ascii=False)
    return out[:limit]


class TelegramBot:
    def __init__(self, token: str, service: AuditService):
        self.api = f"https://api.telegram.org/bot{token}"
        self.file_api = f"https://api.telegram.org/file/bot{token}"
        self.svc = service
        self.offset = 0
        self.last: dict[int, str] = {}
        self.fmt: dict[int, str] = {}
        self.history: dict[int, list[tuple[str, str]]] = {}
        self.http = httpx.Client(timeout=70)
        self._llm = None

    # ------------------------------------------------------------------ transport
    def call(self, method: str, **params):
        files = params.pop("_files", None)
        r = self.http.post(f"{self.api}/{method}", data=params if files else None, json=None if files else params,
                           files=files)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"Telegram {method}: {data.get('description')}")
        return data["result"]

    def send(self, chat: int, text: str, **kw):
        return self.call("sendMessage", chat_id=chat, text=text[:4096], parse_mode="HTML",
                         disable_web_page_preview=True, **kw)

    def edit(self, chat: int, msg: int, text: str):
        try:
            self.call("editMessageText", chat_id=chat, message_id=msg, text=text[:4096], parse_mode="HTML")
        except Exception:
            pass

    def typing(self, chat: int, action: str = "typing"):
        try:
            self.call("sendChatAction", chat_id=chat, action=action)
        except Exception:
            pass

    def send_doc(self, chat: int, name: str, content: bytes, caption: str = ""):
        self.call("sendDocument", chat_id=str(chat), caption=caption[:1024], parse_mode="HTML",
                  _files={"document": (name, content)})

    def llm(self):
        if self._llm is None:
            cfg = self.svc.cfg
            prov = cfg.resolve_provider()
            self._llm = False if prov in ("offline", "mock") else make_client(prov, cfg.resolve_model(prov), cfg)
        return self._llm or None

    # ------------------------------------------------------------------ loop
    def run_forever(self) -> None:
        log.info("Telegram bot started")
        try:
            self.call("setMyCommands", commands=[{"command": "format", "description": "Формат отчёта"},
                                                 {"command": "demo", "description": "Демо-прогон"},
                                                 {"command": "last", "description": "Последний отчёт"},
                                                 {"command": "help", "description": "Помощь"}])
        except Exception as e:
            log.warning("setMyCommands: %s", e)
        while True:
            try:
                updates = self.call("getUpdates", offset=self.offset, timeout=50,
                                    allowed_updates=["message", "callback_query"])
                for u in updates:
                    self.offset = u["update_id"] + 1
                    try:
                        self.handle(u)
                    except Exception:
                        log.exception("update failed")
            except Exception as e:
                log.warning("polling error: %s", str(e)[:200])
                time.sleep(5)

    def handle(self, u: dict) -> None:
        if "callback_query" in u:
            return self.on_callback(u["callback_query"])
        m = u.get("message") or {}
        chat = m.get("chat", {}).get("id")
        if not chat:
            return
        text = (m.get("text") or m.get("caption") or "").strip()
        if text.startswith(("/start", "/help")):
            self.send(chat, HELP)
        elif text.startswith("/format"):
            self.send(chat, "В каком формате присылать отчёт?", reply_markup=self.format_kb("setfmt"))
        elif text.startswith("/demo"):
            self.audit(chat, None, demo=True)
        elif text.startswith("/last"):
            aid = self.last.get(chat) or self._latest()
            if not aid:
                self.send(chat, "Пока нет прогонов. Пришлите документ требований 📎")
            else:
                self.last[chat] = aid
                self.summary(chat, aid)
        elif "document" in m:
            f = wanted_format(text)
            if f:
                self.fmt[chat] = f
            self.audit(chat, m["document"])
        elif "photo" in m:
            ph = max(m["photo"], key=lambda p: p.get("file_size", 0))
            self.audit(chat, {"file_id": ph["file_id"], "file_name": "photo.jpg", "file_size": ph.get("file_size", 0)})
        elif text and self._looks_like_requirements(text):
            path = self.svc.uploads / f"tg_{uuid.uuid4().hex[:8]}_text.md"
            path.write_text(text, encoding="utf-8")
            self.audit(chat, None, path=path, name="текст из сообщения")
        elif text:
            self.chat(chat, text)
        else:
            self.send(chat, "Пришлите документ требований (файл, фото или текст) или /demo 📎")

    @staticmethod
    def _looks_like_requirements(text: str) -> bool:
        lines = [ln for ln in text.splitlines() if ln.strip()]
        return len(text) >= 400 and len(lines) >= 4 and bool(
            re.search(r"должн|требован|систем|пользовател|клиент|\b[A-ZА-Я]{1,4}-\d", text, re.I))

    def _latest(self) -> Optional[str]:
        items = [x for x in self.svc.store.list(5) if not x.get("demo")]
        return items[0]["id"] if items else None

    # ------------------------------------------------------------------ flows
    def audit(self, chat: int, document: Optional[dict], demo: bool = False, path: Optional[Path] = None,
              name: str = "") -> None:
        if demo:
            name = "demo_requirements.md"
        elif document is not None:
            name = document.get("file_name") or "document"
            ext = Path(name).suffix.lower()
            if ext not in SUPPORTED:
                self.send(chat, "⚠️ Этот формат я не читаю. Подойдут: PDF, Word (DOCX), Markdown, TXT, HTML, RTF, "
                                "фото или скан (PNG/JPG). Можно также вставить текст требований сообщением.")
                return
            if document.get("file_size", 0) > 20 * 1024 * 1024:
                self.send(chat, "⚠️ Файл больше 20 МБ.")
                return
            self.typing(chat, "upload_document")
            info = self.call("getFile", file_id=document["file_id"])
            content = self.http.get(f"{self.file_api}/{info['file_path']}").content
            safe = re.sub(r"[^\w.\-]+", "_", name)[-80:]
            path = self.svc.uploads / f"tg_{uuid.uuid4().hex[:8]}_{safe}"
            path.write_bytes(content)
        note = " (распознаю текст с изображения)" if Path(name).suffix.lower() in IMAGE_EXT else ""
        msg = self.send(chat, f"🔍 <b>LÜMEN Core</b> анализирует «{html.escape(name)}»{note}…\n▱▱▱▱▱▱▱▱▱▱ 0/15")
        job = self.svc.submit_demo() if demo else self.svc.submit(path, name)
        shown = 0
        while job.status in ("queued", "running"):
            with job.cond:
                job.cond.wait(timeout=3)
            stages = [e["data"] for e in job.events if e["type"] == "stage" and e["data"]["status"] != "running"]
            if len(stages) != shown and stages:
                shown = len(stages)
                last = stages[-1]
                n = last["index"]
                bar = "▰" * round(10 * n / 15) + "▱" * (10 - round(10 * n / 15))
                self.edit(chat, msg["message_id"], f"🔍 <b>LÜMEN Core</b> · «{html.escape(name)}»\n{bar} {n}/15\n"
                                                   f"<i>{html.escape(last['title'])}</i>")
            self.typing(chat)
        if job.status == "error":
            self.edit(chat, msg["message_id"], f"✖ Анализ не выполнен: {html.escape(job.error)}")
            return
        self.edit(chat, msg["message_id"], f"✅ Анализ «{html.escape(name)}» завершён")
        self.last[chat] = job.id
        self.history[chat] = []
        self.summary(chat, job.id, send_file=True)

    def format_kb(self, prefix: str, aid: str = "") -> dict:
        items = list(FORMATS.items())
        rows = [items[i:i + 3] for i in range(0, len(items), 3)]
        return {"inline_keyboard": [[{"text": label, "callback_data": f"{prefix}:{fmt}:{aid}"} for fmt, label in row]
                                    for row in rows]}

    def summary(self, chat: int, aid: str, send_file: bool = False) -> None:
        r = self.svc.store.get(aid)
        if r is None:
            self.send(chat, "Отчёт не найден")
            return
        s = r.scores
        crit = [f for f in r.findings if f.status == "confirmed" and f.severity in ("CRITICAL", "HIGH")][:5]
        lines = [
            f"<b>{READY[r.readiness]}</b>" + (" · <i>демо</i>" if r.demo else ""),
            html.escape(r.readiness_reason), "",
            f"📄 Требований: <b>{s.total_requirements}</b> · замечаний: <b>{s.findings_total}</b>",
            f"🔴 {s.by_severity['CRITICAL']} · 🟠 {s.by_severity['HIGH']} · 🟡 {s.by_severity['MEDIUM']} · "
            f"🔵 {s.by_severity['LOW']} · ❓ вопросов: {len(r.questions)}",
            f"📈 Индекс качества: <b>{s.quality_index}/100</b> · модель: <code>{html.escape(r.passport.model)}</code>",
        ]
        if crit:
            lines += ["", "<b>Главное исправить:</b>"]
            for f in crit:
                where = f"стр. {f.loc.line_start}" if f.loc else "набор"
                lines.append(f"{SEV[f.severity]} {html.escape(f.title)} <i>({', '.join(f.req_ids[:3]) or 'набор'}; {where})</i>")
        lines += ["", "💬 Спросите меня об отчёте или выберите формат файла ниже."]
        if settings.public_url:
            lines.append(f"🌐 <a href='{settings.public_url.rstrip('/')}/audits/{r.id}'>Открыть в LÜMEN Intelligence</a>")
        kb = self.format_kb("f", r.id)
        kb["inline_keyboard"].insert(0, [{"text": f"❓ Вопросы ({len(r.questions)})", "callback_data": f"q:{r.id}"},
                                         {"text": "🔴 Все критичные", "callback_data": f"c:{r.id}"}])
        self.send(chat, "\n".join(lines), reply_markup=kb)
        if send_file:
            self.send_report(chat, r, self.fmt.get(chat, "pdf"))

    def send_report(self, chat: int, r: AuditResult, fmt: str) -> None:
        self.typing(chat, "upload_document")
        try:
            data = render(r, fmt)
        except Exception as e:
            log.exception("export failed")
            self.send(chat, f"⚠️ Не удалось собрать {FORMATS.get(fmt, fmt)}: {html.escape(str(e)[:200])}. Пришлю HTML.")
            fmt, data = "html", render(r, "html")
        self.send_doc(chat, safe_name(r, fmt), data, f"{FORMATS.get(fmt, fmt)} · отчёт LÜMEN по «{html.escape(r.passport.document_name)}»")

    def chat(self, chat: int, text: str) -> None:
        aid = self.last.get(chat)
        r = self.svc.store.get(aid) if aid else None
        fmt = wanted_format(text)
        if r and fmt and re.search(SEND_WORDS, text.lower()):  # fast path, no model needed
            self.send_report(chat, r, fmt)
            return
        client = self.llm()
        if client is None:
            if r:
                self.send(chat, "Чат с ИИ недоступен: на сервере не задан ключ модели. Могу прислать отчёт — выберите формат:",
                          reply_markup=self.format_kb("f", r.id))
            else:
                self.send(chat, HELP)
            return
        self.typing(chat)
        hist = self.history.setdefault(chat, [])
        context = audit_context(r) if r else "Аудита ещё нет: пользователь не присылал документ."
        try:
            ans: ChatAnswer = client.structured(prompts.CHAT_SYSTEM, prompts.chat_prompt(context, hist, text),
                                                ChatAnswer, "telegram-chat")
        except LLMError as e:
            self.send(chat, f"⚠️ Модель сейчас недоступна: {html.escape(str(e)[:200])}")
            return
        hist += [("Пользователь", text), ("LÜMEN", ans.answer)]
        del hist[:-12]
        self.send(chat, html.escape(ans.answer))
        if r and ans.send_format != "none":
            self.send_report(chat, r, ans.send_format)

    def on_callback(self, cq: dict) -> None:
        chat = cq["message"]["chat"]["id"]
        parts = (cq.get("data") or "").split(":")
        try:
            self.call("answerCallbackQuery", callback_query_id=cq["id"])
        except Exception:
            pass
        kind = parts[0]
        if kind == "setfmt":
            self.fmt[chat] = parts[1]
            self.send(chat, f"Готово: отчёты буду присылать в формате {FORMATS[parts[1]]}.")
            return
        aid = parts[-1]
        r = self.svc.store.get(aid)
        if r is None:
            self.send(chat, "Отчёт не найден")
            return
        self.last[chat] = aid
        if kind == "f":
            self.send_report(chat, r, parts[1])
        elif kind == "q":
            out = ["<b>❓ Вопросы к владельцу требований</b>"]
            for q in r.questions[:12]:
                opts = " / ".join(q.options[:4])
                out.append(f"\n<b>{q.id}</b> ({', '.join(q.req_ids) or 'набор'}) {html.escape(q.question)}\n"
                           f"<i>{html.escape(q.why)}</i>" + (f"\n▫️ {html.escape(opts)}" if opts else ""))
            self.send(chat, "\n".join(out))
        elif kind == "c":
            out = ["<b>🔴 Критичные и существенные дефекты</b>"]
            for f in [f for f in r.findings if f.severity in ("CRITICAL", "HIGH")][:12]:
                where = f.loc.label() if f.loc else "документ в целом"
                out.append(f"\n{SEV[f.severity]} <b>{f.id}</b> {html.escape(f.title)}\n<i>{html.escape(where)}</i>\n"
                           f"{html.escape(f.problem[:300])}\n➡️ {html.escape(f.fix[:200])}")
            self.send(chat, "\n".join(out))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if not settings.telegram_token:
        raise SystemExit("TELEGRAM_BOT_TOKEN не задан. Создайте бота у @BotFather и добавьте токен в .env.")
    from ..service import get_service

    TelegramBot(settings.telegram_token, get_service()).run_forever()


if __name__ == "__main__":
    main()
