"""LÜMEN Support desk — a separate Telegram bot for the team, so tickets do not mix with users' chats.

* Every ticket («Передать команде» on the site, /support or an escalation in the main bot) arrives here.
* /start shows the chat ID to put into LUMEN_SUPPORT_CHAT_ID (several IDs — comma-separated).
* Reply to a ticket that came from Telegram, and the user receives the answer from the main LÜMEN bot.

Only chats listed in LUMEN_SUPPORT_CHAT_ID can answer users: anyone else just gets their chat ID.
"""
from __future__ import annotations

import html
import logging
import os
import re
import time

import httpx

log = logging.getLogger("lumen.support_bot")
USER_RE = re.compile(r"telegram:(-?\d+)")


def team_chats() -> list[str]:
    return [x.strip() for x in os.environ.get("LUMEN_SUPPORT_CHAT_ID", "").split(",") if x.strip()]


def desk_token() -> str:
    """The support bot's token, or the main bot's when no separate support bot is set up."""
    return os.environ.get("LUMEN_SUPPORT_BOT_TOKEN", "") or os.environ.get("TELEGRAM_BOT_TOKEN", "")


def notify_team(text: str) -> None:
    token = desk_token()
    for chat in team_chats():
        try:
            httpx.post(f"https://api.telegram.org/bot{token}/sendMessage",
                       json={"chat_id": chat, "text": text, "parse_mode": "HTML"}, timeout=10)
        except Exception:
            pass  # the ticket is stored anyway


class SupportDesk:
    def __init__(self, token: str, user_bot_token: str):
        self.api = f"https://api.telegram.org/bot{token}"
        self.user_api = f"https://api.telegram.org/bot{user_bot_token}"
        self.http = httpx.Client(timeout=70)
        self.offset = 0

    def send(self, api: str, chat, text: str) -> bool:
        r = self.http.post(f"{api}/sendMessage", json={"chat_id": chat, "text": text, "parse_mode": "HTML"})
        return r.status_code == 200 and r.json().get("ok", False)

    def handle(self, m: dict) -> None:
        chat = m.get("chat", {}).get("id")
        text = (m.get("text") or "").strip()
        if not chat:
            return
        if text.startswith("/start") or text.startswith("/id"):
            self.send(self.api, chat, f"👋 Это служба поддержки LÜMEN.\nID этого чата: <code>{chat}</code>\n"
                                      "Впишите его в Railway в переменную <b>LUMEN_SUPPORT_CHAT_ID</b> — сюда начнут "
                                      "приходить обращения. Чтобы ответить пользователю из Telegram, ответьте "
                                      "(Reply) на его обращение.")
            return
        reply_to = (m.get("reply_to_message") or {}).get("text") or ""
        if str(chat) not in team_chats() or not reply_to or not text:
            return
        hit = USER_RE.search(reply_to)
        ticket = re.search(r"Обращение (\w+)", reply_to)
        if not hit:
            self.send(self.api, chat, "Это обращение пришло с сайта — ответьте пользователю по контакту, который он оставил.")
            return
        ok = self.send(self.user_api, int(hit.group(1)),
                       f"💬 <b>Ответ команды LÜMEN</b>" + (f" на обращение №{ticket.group(1)}" if ticket else "")
                       + f"\n\n{html.escape(text)}")
        self.send(self.api, chat, "✅ Ответ отправлен пользователю." if ok else "⚠️ Не удалось отправить: пользователь "
                                                                                   "мог остановить бота.")

    def run_forever(self) -> None:
        log.info("Support desk bot started")
        while True:
            try:
                r = self.http.get(f"{self.api}/getUpdates", params={"offset": self.offset, "timeout": 50,
                                                                    "allowed_updates": '["message"]'})
                for u in r.json().get("result", []):
                    self.offset = u["update_id"] + 1
                    try:
                        self.handle(u.get("message") or {})
                    except Exception:
                        log.exception("support update failed")
            except Exception as e:
                log.warning("support polling error: %s", str(e)[:200])
                time.sleep(5)
