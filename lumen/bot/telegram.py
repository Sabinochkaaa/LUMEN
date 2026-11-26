"""LÜMEN Telegram bot: send a requirements file → get readiness verdict, critical defects, questions and reports.

    python -m lumen.bot            # standalone (long polling)
    LUMEN_BOT_IN_API=1 uvicorn …   # or inside the API process (default when TELEGRAM_BOT_TOKEN is set)
"""
from __future__ import annotations

import html
import logging
import re
import time
import uuid
from pathlib import Path

import httpx

from ..config import settings
from ..engine.pipeline import AuditError
from ..parsing.loader import SUPPORTED
from ..report.render import render_html, render_markdown
from ..service import AuditService

log = logging.getLogger("lumen.bot")
READY = {"READY": "✅ READY", "READY WITH CONDITIONS": "🟡 READY WITH CONDITIONS", "NOT READY": "❌ NOT READY",
         "INSUFFICIENT DATA": "⚪ INSUFFICIENT DATA"}
SEV = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}
HELP = (
    "<b>LÜMEN Requirements Intelligence</b>\n"
    "AI-аудитор требований для банков и финтеха (ISO/IEC/IEEE 29148, IEEE 830).\n\n"
    "📎 Пришлите документ требований — <b>PDF, DOCX, MD или TXT</b> (до 20 МБ). Я выделю требования, найду "
    "противоречия, пробелы и FinTech-риски, задам уточняющие вопросы и пришлю отчёт.\n\n"
    "/demo — демонстрационный прогон\n/last — последний отчёт\n/help — помощь"
)


class TelegramBot:
    def __init__(self, token: str, service: AuditService):
        self.api = f"https://api.telegram.org/bot{token}"
        self.file_api = f"https://api.telegram.org/file/bot{token}"
        self.svc = service
        self.offset = 0
        self.last: dict[int, str] = {}
        self.http = httpx.Client(timeout=70)

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

    def send_doc(self, chat: int, name: str, content: bytes, caption: str = ""):
        self.call("sendDocument", chat_id=str(chat), caption=caption[:1024], parse_mode="HTML",
                  _files={"document": (name, content)})

    # ------------------------------------------------------------------ loop
    def run_forever(self) -> None:
        log.info("Telegram bot started")
        try:
            self.call("setMyCommands", commands=[{"command": "demo", "description": "Демо-прогон"},
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
        text = (m.get("text") or "").strip()
        if text.startswith(("/start", "/help")):
            self.send(chat, HELP)
        elif text.startswith("/demo"):
            self.audit(chat, None, demo=True)
        elif text.startswith("/last"):
            aid = self.last.get(chat)
            if not aid:
                self.send(chat, "Пока нет прогонов. Пришлите документ требований 📎")
            else:
                self.summary(chat, aid)
        elif "document" in m:
            self.audit(chat, m["document"])
        else:
            self.send(chat, "Пришлите файл требований (PDF, DOCX, MD, TXT) или /demo 📎")

    # ------------------------------------------------------------------ flows
    def audit(self, chat: int, document: dict | None, demo: bool = False) -> None:
        if demo:
            path, name = None, "demo_requirements.md"
        else:
            name = document.get("file_name") or "document"
            if Path(name).suffix.lower() not in SUPPORTED:
                self.send(chat, "⚠️ Поддерживаются только PDF, DOCX, MD и TXT.")
                return
            if document.get("file_size", 0) > 20 * 1024 * 1024:
                self.send(chat, "⚠️ Файл больше 20 МБ.")
                return
            info = self.call("getFile", file_id=document["file_id"])
            content = self.http.get(f"{self.file_api}/{info['file_path']}").content
            safe = re.sub(r"[^\w.\-]+", "_", name)[-80:]
            path = self.svc.uploads / f"tg_{uuid.uuid4().hex[:8]}_{safe}"
            path.write_bytes(content)
        msg = self.send(chat, f"🔍 <b>LÜMEN Core</b> анализирует «{html.escape(name)}»…\n▱▱▱▱▱▱▱▱▱▱ 0/15")
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
        if job.status == "error":
            self.edit(chat, msg["message_id"], f"✖ Анализ не выполнен: {html.escape(job.error)}")
            return
        self.edit(chat, msg["message_id"], f"✅ Анализ «{html.escape(name)}» завершён")
        self.last[chat] = job.id
        self.summary(chat, job.id, send_files=True)

    def summary(self, chat: int, aid: str, send_files: bool = False) -> None:
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
        if settings.public_url:
            lines += ["", f"🌐 <a href='{settings.public_url.rstrip('/')}/audits/{r.id}'>Открыть в LÜMEN Intelligence</a>"]
        kb = {"inline_keyboard": [[{"text": f"❓ Вопросы ({len(r.questions)})", "callback_data": f"q:{r.id}"},
                                   {"text": "🔴 Все критичные", "callback_data": f"c:{r.id}"}],
                                  [{"text": "📑 Отчёт HTML", "callback_data": f"h:{r.id}"},
                                   {"text": "📝 Отчёт MD", "callback_data": f"m:{r.id}"}]]}
        self.send(chat, "\n".join(lines), reply_markup=kb)
        if send_files:
            self._files(chat, r, ("html",))

    def _files(self, chat, r, fmts):
        base = re.sub(r"[^\w\-]+", "_", Path(r.passport.document_name).stem)[:40]
        if "html" in fmts:
            self.send_doc(chat, f"lumen_{base}.html", render_html(r).encode(), "📑 Интерактивный отчёт (откройте в браузере)")
        if "md" in fmts:
            self.send_doc(chat, f"lumen_{base}.md", render_markdown(r).encode(), "📝 Отчёт в Markdown")

    def on_callback(self, cq: dict) -> None:
        chat = cq["message"]["chat"]["id"]
        kind, _, aid = (cq.get("data") or "").partition(":")
        try:
            self.call("answerCallbackQuery", callback_query_id=cq["id"])
        except Exception:
            pass
        r = self.svc.store.get(aid)
        if r is None:
            self.send(chat, "Отчёт не найден")
            return
        if kind == "q":
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
        elif kind in ("h", "m"):
            self._files(chat, r, ("html",) if kind == "h" else ("md",))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if not settings.telegram_token:
        raise SystemExit("TELEGRAM_BOT_TOKEN не задан. Создайте бота у @BotFather и добавьте токен в .env.")
    from ..service import get_service

    TelegramBot(settings.telegram_token, get_service()).run_forever()


if __name__ == "__main__":
    main()
