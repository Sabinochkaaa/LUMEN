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
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx

from ..config import settings
from ..llm import prompts
from ..llm.client import LLMError, make_chain
from ..llm.schemas import ChatAnswer
from ..models import AuditResult
from ..parsing.loader import IMAGE_EXT, SUPPORTED
from ..report.export import render, safe_name
from ..security import UploadRejected, limiter, safe_filename, validate_upload
from ..service import AuditService
from ..translate import LANG_NAMES, detect_target, markdown_to_docx, translate_document, wants_translation

log = logging.getLogger("lumen.bot")
logging.getLogger("httpx").setLevel(logging.WARNING)  # never log URLs that contain the bot token
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
    "💬 Потом спрашивайте: «что не так с Ф-3?», «перепиши REQ-010», «почему NOT READY?», «пришли в Excel».\n"
    "🌐 Перевод: пришлите файл с подписью «переведи на английский» (или казахский/русский), либо напишите это после анализа.\n"
    "✍️ Генератор: «/generate кэшбэк 1% в кафе» — напишу черновик ТЗ по шаблону банка и сразу проверю.\n"
    "🎙 Можно голосовыми.\n\n"
    "/generate — написать ТЗ по идее\n/support — написать в поддержку\n/format — формат отчёта по умолчанию\n"
    "/demo — демонстрационный прогон\n/last — последний отчёт\n/help — помощь"
)
# buttons under the welcome message and the report summary
MENU_KB = {"inline_keyboard": [[{"text": "✍️ Сгенерировать ТЗ", "callback_data": "gen"},
                                {"text": "🆘 Поддержка", "callback_data": "sup"}],
                               [{"text": "🧪 Демо-проверка", "callback_data": "demo"}]]}
GEN_WORDS = r"^(/generate|/gen)\b|^(сгенерируй|сгенерировать|напиши|составь|создай)\s+(мне\s+)?(тз|техзадание|техническое задание|требования)"


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
        self.waiting: dict[int, str] = {}       # chat → "gen" | "ticket": the next message is an idea or a ticket
        self.generated: dict[str, Path] = {}    # token → generated spec file, for the «Проверить» button

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
            self._llm = False if prov in ("offline", "mock") else make_chain(prov, cfg.resolve_model(prov), cfg)
        return self._llm or None

    # ------------------------------------------------------------------ loop
    def run_forever(self) -> None:
        log.info("Telegram bot started")
        try:
            self.call("setMyCommands", commands=[{"command": "generate", "description": "Написать ТЗ по идее"},
                                                 {"command": "support", "description": "Написать в поддержку"},
                                                 {"command": "format", "description": "Формат отчёта"},
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
        if ("voice" in m or "audio" in m) and not text:
            return self.voice(chat, m, u)
        waiting = self.waiting.pop(chat, None)
        if text.startswith(("/start", "/help")):
            self.send(chat, HELP, reply_markup=MENU_KB)
        elif text.startswith("/support"):
            rest = text[len("/support"):].strip()
            if rest:
                self.ticket(chat, rest)
            else:
                self.waiting[chat] = "ticket"
                self.send(chat, "🆘 Опишите вопрос или проблему одним сообщением (можно голосовым) — передам команде LÜMEN.")
        elif re.search(GEN_WORDS, text, re.I):
            idea = re.sub(GEN_WORDS, "", text, flags=re.I).strip(" :—-")
            if len(idea) >= 10:
                self.generate(chat, idea)
            else:
                self.waiting[chat] = "gen"
                self.send(chat, "✍️ Опишите идею одним сообщением (можно голосовым), например: «перевод по номеру телефона "
                                "с лимитом 500 000 ₸ в сутки и подтверждением по SMS».")
        elif waiting == "ticket" and text and not text.startswith("/"):
            self.ticket(chat, text)
        elif waiting == "gen" and text and not text.startswith("/"):
            self.generate(chat, text)
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
        elif "document" in m and text and wants_translation(text):
            self.translate(chat, m["document"], detect_target(text) or "en")
        elif "document" in m:
            f = wanted_format(text)
            if f:
                self.fmt[chat] = f
            self.audit(chat, m["document"])
        elif "photo" in m:
            ph = max(m["photo"], key=lambda p: p.get("file_size", 0))
            self.audit(chat, {"file_id": ph["file_id"], "file_name": "photo.jpg", "file_size": ph.get("file_size", 0)})
        elif text and self._looks_like_requirements(text):
            path = self.svc.uploads / f"tg_{uuid.uuid4().hex}_text.md"
            path.write_text(text, encoding="utf-8")
            self.audit(chat, None, path=path, name="текст из сообщения")
        elif text and wants_translation(text) and self.last.get(chat):
            self.translate(chat, None, detect_target(text) or "en")
        elif text:
            self.chat(chat, text)
        else:
            self.send(chat, "Пришлите документ требований (файл, фото или текст) или /demo 📎")

    def voice(self, chat: int, m: dict, u: dict) -> None:
        """A voice note becomes a text message: the bot shows what it heard and answers as if it were typed."""
        from ..voice import VoiceError, transcribe

        v = m.get("voice") or m.get("audio") or {}
        ok, retry = limiter.allow(f"bot-voice:{chat}", 30, 3600)
        if not ok:
            self.send(chat, f"⏳ Лимит голосовых на этот час исчерпан. Попробуйте через {retry // 60 + 1} мин.")
            return
        if v.get("duration", 0) > 180:
            self.send(chat, "🎙 Запись длиннее 3 минут — задайте вопрос короче или напишите текстом.")
            return
        self.typing(chat)
        try:
            info = self.call("getFile", file_id=v["file_id"])
            data = self.http.get(f"{self.file_api}/{info['file_path']}").content
            text = transcribe(data, v.get("file_name") or info.get("file_path", "voice.ogg"), cfg=self.svc.cfg)
        except VoiceError as e:
            self.send(chat, f"🎙 {html.escape(str(e))}")
            return
        except Exception:
            self.send(chat, "🎙 Не получилось распознать голосовое — попробуйте ещё раз или напишите текстом.")
            return
        self.send(chat, f"🎙 <i>{html.escape(text)}</i>")
        self.handle({**u, "message": {**m, "text": text, "voice": None, "audio": None}})

    @staticmethod
    def _looks_like_requirements(text: str) -> bool:
        lines = [ln for ln in text.splitlines() if ln.strip()]
        return len(text) >= 400 and len(lines) >= 4 and bool(
            re.search(r"должн|требован|систем|пользовател|клиент|\b[A-ZА-Я]{1,4}-\d", text, re.I))

    def _latest(self) -> Optional[str]:
        return None  # чужие прогоны боту не показываем: только свои, из этого чата

    # ------------------------------------------------------------------ flows
    def audit(self, chat: int, document: Optional[dict], demo: bool = False, path: Optional[Path] = None,
              name: str = "") -> None:
        ok, retry = limiter.allow(f"bot-audit:{chat}", self.svc.cfg.bot_audits_per_hour, 3600)
        if not ok:
            self.send(chat, f"⏳ Лимит анализов на этот час исчерпан. Попробуйте через {retry // 60 + 1} мин.")
            if path and path.exists():
                path.unlink()
            return
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
            try:
                validate_upload(name, content)
            except UploadRejected as e:
                self.send(chat, f"⚠️ {html.escape(str(e))}")
                return
            safe = re.sub(r"[^\w.\-]+", "_", name)[-80:]
            path = self.svc.uploads / f"tg_{uuid.uuid4().hex}_{safe}"
            path.write_bytes(content)
        note = " (распознаю текст с изображения)" if Path(name).suffix.lower() in IMAGE_EXT else ""
        msg = self.send(chat, f"🔍 <b>LÜMEN Core</b> анализирует «{html.escape(name)}»{note}…\n▱▱▱▱▱▱▱▱▱▱ 0/15")
        job = self.svc.submit_demo(private=True) if demo else self.svc.submit(path, name, private=True)
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

    def _download(self, chat: int, document: dict) -> Optional[Path]:
        name = document.get("file_name") or "document"
        if Path(name).suffix.lower() not in SUPPORTED:
            self.send(chat, "⚠️ Этот формат я не читаю. Подойдут: PDF, Word, Markdown, TXT, HTML, RTF, фото или скан.")
            return None
        if document.get("file_size", 0) > 20 * 1024 * 1024:
            self.send(chat, "⚠️ Файл больше 20 МБ.")
            return None
        info = self.call("getFile", file_id=document["file_id"])
        content = self.http.get(f"{self.file_api}/{info['file_path']}").content
        try:
            validate_upload(name, content)
        except UploadRejected as e:
            self.send(chat, f"⚠️ {html.escape(str(e))}")
            return None
        path = self.svc.uploads / f"tg_{uuid.uuid4().hex}_{safe_filename(name)}"
        path.write_bytes(content)
        return path

    def translate(self, chat: int, document: Optional[dict], target: str) -> None:
        ok, retry = limiter.allow(f"bot-audit:{chat}", self.svc.cfg.bot_audits_per_hour, 3600)
        if not ok:
            self.send(chat, f"⏳ Лимит на этот час исчерпан. Попробуйте через {retry // 60 + 1} мин.")
            return
        if document is not None:
            path = self._download(chat, document)
            if path is None:
                return
            name = document.get("file_name") or "document"
        else:
            r = self.svc.store.get(self.last[chat])
            if r is None or not r.source:
                self.send(chat, "Пришлите документ, который нужно перевести 📎")
                return
            name = r.passport.document_name
            path = self.svc.uploads / f"tg_{uuid.uuid4().hex}_source.md"
            path.write_text("\n".join(l.text for l in r.source), encoding="utf-8")
        msg = self.send(chat, f"🌐 Перевожу «{html.escape(name)}» → {LANG_NAMES[target]}…")
        self.typing(chat)
        try:
            tr = translate_document(path, target, display_name=name, cfg=self.svc.cfg,
                                    progress=lambda i, n: self.edit(chat, msg["message_id"],
                                                                    f"🌐 Перевожу «{html.escape(name)}» → {LANG_NAMES[target]}… {i}/{n}"))
        except Exception as e:
            log.warning("translate failed: %s", e)
            self.edit(chat, msg["message_id"], f"⚠️ Перевод не выполнен: {html.escape(str(e)[:300])}")
            return
        finally:
            path.unlink(missing_ok=True)
        base = re.sub(r"[^\w\-]+", "_", Path(name).stem)[:40]
        self.edit(chat, msg["message_id"], f"✅ Перевод готов → {LANG_NAMES[target]} · модель {html.escape(tr.model)}")
        self.send_doc(chat, f"{base}_{target}.docx", markdown_to_docx(tr.markdown, name), "📘 Перевод (Word)")
        self.send_doc(chat, f"{base}_{target}.md", tr.markdown.encode("utf-8"), "📝 Перевод (Markdown)")

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
        from ..report.digest import build

        crit = build(r).fixes  # the same top list as page 1 of the PDF and the site
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
                where = ((f"стр. {f.loc.page}, " if f.loc.page else "") + f"строка {f.loc.line_start}") if f.loc else "набор"
                lines.append(f"{SEV[f.severity]} {html.escape(f.title)} <i>({', '.join(f.req_ids[:3]) or 'набор'}; {where})</i>")
        lines += ["", "💬 Спросите меня об отчёте или выберите формат файла ниже."]
        if settings.public_url:
            lines.append(f"🌐 <a href='{settings.public_url.rstrip('/')}/audits/{r.id}'>Открыть в LÜMEN Intelligence</a>")
        kb = self.format_kb("f", r.id)
        kb["inline_keyboard"].insert(0, [{"text": f"❓ Вопросы ({len(r.questions)})", "callback_data": f"q:{r.id}"},
                                         {"text": "🔴 Все критичные", "callback_data": f"c:{r.id}"}])
        kb["inline_keyboard"].append([{"text": "🆘 Поддержка", "callback_data": "sup"}])
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

    def ticket(self, chat: int, text: str) -> None:
        from ..support import save_ticket

        ok, retry = limiter.allow(f"bot-ticket:{chat}", 5, 3600)
        if not ok:
            self.send(chat, f"⏳ Слишком много обращений. Попробуйте через {retry // 60 + 1} мин.")
            return
        t = save_ticket(self.svc.cfg.data_dir, text[:2000], self.history.get(chat) and
                        [{"role": "user" if w == "Пользователь" else "agent", "text": x} for w, x in self.history[chat]],
                        f"telegram:{chat}", "telegram", self.last.get(chat, ""), cfg=self.svc.cfg)
        self.send(chat, f"📨 Передал команде LÜMEN, обращение №<code>{t['id']}</code>. Ответим сюда, в этот чат.")

    def generate(self, chat: int, idea: str) -> None:
        """LÜMEN Author in Telegram: the idea becomes a spec file, with a button to review it right away."""
        ok, retry = limiter.allow(f"bot-gen:{chat}", 10, 3600)
        if not ok:
            self.send(chat, f"⏳ Лимит генераций на этот час исчерпан. Попробуйте через {retry // 60 + 1} мин.")
            return

        def work():
            from ..generate import generate_spec

            self.send(chat, "✍️ Пишу ТЗ по шаблону банка… обычно до минуты.")
            self.typing(chat, "upload_document")
            try:
                res = generate_spec(idea, "ru", cfg=self.svc.cfg)
            except Exception as e:
                log.warning("generate failed: %s", str(e)[:200])
                self.send(chat, "⚠️ Не получилось написать ТЗ — модель сейчас занята. Попробуйте через минуту: /generate")
                return
            slug = re.sub(r"[^\w]+", "_", res.title, flags=re.U).strip("_")[:50] or "spec"
            token = uuid.uuid4().hex[:12]
            path = self.svc.uploads / f"tg_{token}_{slug}.md"
            path.write_text(res.markdown, encoding="utf-8")
            self.generated[token] = path
            gaps = len(re.findall(r"\[уточнить", res.markdown, re.I))
            self.send_doc(chat, f"{slug}.md", res.markdown.encode("utf-8"),
                          f"✍️ Черновик ТЗ «{html.escape(res.title)}» · пометок «уточнить»: {gaps}")
            self.send(chat, "Проверить этот черновик командой агентов?",
                      reply_markup={"inline_keyboard": [[{"text": "🔎 Проверить этот ТЗ", "callback_data": f"check:{token}"}]]})

        threading.Thread(target=work, daemon=True, name="lumen-bot-generate").start()

    def chat(self, chat: int, text: str) -> None:
        ok, retry = limiter.allow(f"bot-msg:{chat}", self.svc.cfg.bot_messages_per_hour, 3600)
        if not ok:
            self.send(chat, f"⏳ Слишком много сообщений. Попробуйте через {retry // 60 + 1} мин.")
            return
        text = text[:2000]
        aid = self.last.get(chat)
        r = self.svc.store.get(aid) if aid else None
        fmt = wanted_format(text)
        if r and fmt and re.search(SEND_WORDS, text.lower()):  # fast path, no model needed
            self.send_report(chat, r, fmt)
            return
        client = self.llm()
        if r is None:  # no report yet: the support agent answers questions about LÜMEN itself
            from ..support import answer as support_answer, save_ticket

            hist = self.history.setdefault(chat, [])
            self.typing(chat)
            rep = support_answer(text, [{"role": "user" if who == "Пользователь" else "agent", "text": t}
                                        for who, t in hist], "ru", None, client)
            msg = rep.answer
            if rep.escalate:
                save_ticket(self.svc.cfg.data_dir, text, None, f"telegram:{chat}", "telegram", cfg=self.svc.cfg)
                msg += "\n\n📨 Передал вопрос команде LÜMEN."
            hist += [("Пользователь", text), ("LÜMEN", rep.answer)]
            del hist[:-12]
            self.send(chat, html.escape(msg) + "\n\nЧтобы проверить ТЗ, просто пришлите файл 📎")
            return
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
            from ..knowledge.glossary import knowledge_block

            kb = knowledge_block("\n".join(l.text for l in r.source)) if r else ""
            ans: ChatAnswer = client.structured(prompts.CHAT_SYSTEM + ("\n\n" + kb if kb else ""),
                                                prompts.chat_prompt(context, hist, text), ChatAnswer, "telegram-chat")
        except LLMError as e:
            log.warning("chat LLM error: %s", e)
            quota = "Квота" in str(e)
            msg = ("⚠️ ИИ-чат временно недоступен: у модели закончилась бесплатная квота. "
                   if quota else "⚠️ ИИ-чат временно недоступен: модель не ответила. ")
            if r:
                self.send(chat, msg + "Отчёт доступен — выберите формат:", reply_markup=self.format_kb("f", r.id))
            else:
                self.send(chat, msg + "Пришлите документ требований — анализ правилами работает и без ИИ 📎")
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
        if kind == "sup":
            self.waiting[chat] = "ticket"
            self.send(chat, "🆘 Опишите вопрос или проблему одним сообщением (можно голосовым) — передам команде LÜMEN.")
            return
        if kind == "gen":
            self.waiting[chat] = "gen"
            self.send(chat, "✍️ Опишите идею одним сообщением (можно голосовым) — напишу черновик ТЗ по шаблону банка.")
            return
        if kind == "demo":
            self.audit(chat, None, demo=True)
            return
        if kind == "check":
            path = self.generated.pop(parts[1], None) if len(parts) > 1 else None
            if path is None or not path.exists():
                self.send(chat, "Черновик устарел — сгенерируйте ТЗ заново: /generate")
            else:
                self.audit(chat, None, path=path, name=path.name.split("_", 2)[-1])
            return
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
