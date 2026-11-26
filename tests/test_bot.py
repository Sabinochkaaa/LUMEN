from lumen.bot.telegram import TelegramBot
from lumen.config import Settings
from lumen.service import AuditService


class FakeBot(TelegramBot):
    def __init__(self, svc):
        super().__init__("TEST", svc)
        self.sent = []

    def call(self, method, **params):
        self.sent.append((method, params))
        if method == "sendMessage":
            return {"message_id": len(self.sent)}
        return True


def test_bot_demo_flow(tmp_path):
    s = Settings()
    s.data_dir = tmp_path
    bot = FakeBot(AuditService(s))
    bot.handle({"message": {"chat": {"id": 1}, "text": "/start"}})
    assert "PDF, DOCX" in bot.sent[0][1]["text"]
    bot.handle({"message": {"chat": {"id": 1}, "text": "/demo"}})
    texts = [p.get("text", "") for m, p in bot.sent if m == "sendMessage"]
    assert any("NOT READY" in t for t in texts)
    assert any(m == "sendDocument" for m, _ in bot.sent)  # HTML report attached
    aid = bot.last[1]
    bot.handle({"callback_query": {"id": "c", "data": f"q:{aid}", "message": {"chat": {"id": 1}}}})
    assert "Вопросы" in [p for m, p in bot.sent if m == "sendMessage"][-1]["text"]
    bot.handle({"message": {"chat": {"id": 1}, "document": {"file_name": "x.xlsx", "file_id": "f"}}})
    assert "Поддерживаются" in bot.sent[-1][1]["text"]
