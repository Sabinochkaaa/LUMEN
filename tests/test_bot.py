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
    assert "PDF, Word" in bot.sent[0][1]["text"]
    bot.handle({"message": {"chat": {"id": 1}, "text": "/demo"}})
    texts = [p.get("text", "") for m, p in bot.sent if m == "sendMessage"]
    assert any("NOT READY" in t for t in texts)
    assert any(m == "sendDocument" for m, _ in bot.sent)  # HTML report attached
    aid = bot.last[1]
    bot.handle({"callback_query": {"id": "c", "data": f"q:{aid}", "message": {"chat": {"id": 1}}}})
    assert "Вопросы" in [p for m, p in bot.sent if m == "sendMessage"][-1]["text"]
    bot.handle({"message": {"chat": {"id": 1}, "document": {"file_name": "x.xlsx", "file_id": "f"}}})
    assert "не читаю" in bot.sent[-1][1]["text"]


def test_bot_formats_and_chat(tmp_path):
    from lumen.llm.client import MockClient

    s = Settings()
    s.data_dir = tmp_path
    bot = FakeBot(AuditService(s))
    bot.handle({"message": {"chat": {"id": 7}, "text": "/demo"}})
    docs = [p for m, p in bot.sent if m == "sendDocument"]
    assert docs and docs[-1]["_files"]["document"][0].endswith(".pdf")  # PDF by default
    aid = bot.last[7]
    bot.handle({"callback_query": {"id": "c", "data": f"f:xlsx:{aid}", "message": {"chat": {"id": 7}}}})
    assert [p for m, p in bot.sent if m == "sendDocument"][-1]["_files"]["document"][0].endswith(".xlsx")
    bot.handle({"message": {"chat": {"id": 7}, "text": "скинь в ворде пожалуйста"}})  # no model needed
    assert [p for m, p in bot.sent if m == "sendDocument"][-1]["_files"]["document"][0].endswith(".docx")
    # chat with the model, grounded on the audit
    seen = {}

    def responder(step, user):
        seen["user"] = user
        return {"answer": "F-001: критерий приёмки противоречит лимиту FR-3.", "send_format": "html"}

    bot._llm = MockClient("mock", s, responder)
    bot.handle({"message": {"chat": {"id": 7}, "text": "почему не готов?"}})
    assert "F-001" in [p for m, p in bot.sent if m == "sendMessage"][-1]["text"]
    assert "F-001" in seen["user"] and "почему не готов?" in seen["user"]
    assert [p for m, p in bot.sent if m == "sendDocument"][-1]["_files"]["document"][0].endswith(".html")
    # pasted requirements text is audited as a document
    text = "Требования к сервису\n" + "\n".join(f"FR-{i}. Система должна сохранять настройку клиента номер {i}." for i in range(1, 8))
    bot.handle({"message": {"chat": {"id": 7}, "text": text}})
    assert bot.last[7] != aid
