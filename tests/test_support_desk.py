"""Support desk bot: team replies reach Telegram users; strangers cannot message users through it."""
from lumen.bot.support_bot import SupportDesk


def desk(monkeypatch, team="111"):
    monkeypatch.setenv("LUMEN_SUPPORT_CHAT_ID", team)
    d = SupportDesk("desk-token", "user-token")
    sent = []
    d.send = lambda api, chat, text: sent.append((api.rsplit("/", 1)[-1], chat, text)) or True
    return d, sent


TICKET = "🆘 Обращение ab12cd (telegram)\n\nНе приходит отчёт\n\nКонтакт: telegram:555"


def test_team_reply_goes_to_the_user(monkeypatch):
    d, sent = desk(monkeypatch)
    d.handle({"chat": {"id": 111}, "text": "Проверьте ещё раз, починили", "reply_to_message": {"text": TICKET}})
    assert sent[0][0] == "botuser-token" and sent[0][1] == 555 and "ab12cd" in sent[0][2] and "починили" in sent[0][2]


def test_strangers_cannot_answer_users(monkeypatch):
    d, sent = desk(monkeypatch)
    d.handle({"chat": {"id": 999}, "text": "spam", "reply_to_message": {"text": TICKET}})
    assert sent == []


def test_start_shows_chat_id(monkeypatch):
    d, sent = desk(monkeypatch)
    d.handle({"chat": {"id": 42}, "text": "/start"})
    assert "42" in sent[0][2] and "LUMEN_SUPPORT_CHAT_ID" in sent[0][2]
