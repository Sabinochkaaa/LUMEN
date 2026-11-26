import time

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from lumen import service
    from lumen.config import Settings

    s = Settings()
    s.data_dir = tmp_path
    s.provider = "offline"
    monkeypatch.setattr(service, "_service", service.AuditService(s))
    from lumen.api.app import app

    return TestClient(app)


def wait(client, aid):
    for _ in range(100):
        r = client.get(f"/api/audits/{aid}")
        if r.status_code == 200:
            return r.json()
        time.sleep(0.05)
    raise AssertionError(r.text)


def test_health(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and "pdf" in h["formats"]


def test_upload_flow(client):
    body = "# S\n\n## Функциональные требования\n* **F-1.** Система быстро сохраняет порог.\n* **F-2.** Клиент видит сумму.\n* **F-3.** Клиент получает push.\n"
    r = client.post("/api/audits", files={"file": ("req.md", body.encode(), "text/markdown")})
    assert r.status_code == 200
    aid = r.json()["audit_id"]
    a = wait(client, aid)
    assert a["scores"]["total_requirements"] == 3 and a["source"]
    stream = client.get(f"/api/audits/{aid}/events").text
    assert "event: stage" in stream and "event: result" in stream
    q = a["questions"][0]["id"]
    p = client.patch(f"/api/audits/{aid}/questions/{q}", json={"status": "clarified", "answer": "до 1 секунды"})
    assert p.status_code == 200 and p.json()["question"]["status"] == "clarified"
    assert p.json()["scores"]["open_questions"] == len(a["questions"]) - 1
    md = client.get(f"/api/audits/{aid}/report.md").text
    assert "до 1 секунды" in md and "уточнён" in md
    assert client.get(f"/api/audits/{aid}/report.html").status_code == 200
    assert client.get("/api/audits").json()["items"][0]["id"] == aid
    assert client.delete(f"/api/audits/{aid}").json()["deleted"]


def test_rejects_bad_files(client):
    assert client.post("/api/audits", files={"file": ("a.xlsx", b"x")}).status_code == 415
    assert client.post("/api/audits", files={"file": ("a.md", b"   ")}).status_code == 422
    assert client.get("/api/audits/nope").status_code == 404


def test_demo(client):
    aid = client.post("/api/demo").json()["audit_id"]
    a = wait(client, aid)
    assert a["demo"] is True and a["passport"]["mode"] == "mock"


def test_token_protection(client, monkeypatch):
    from lumen.config import settings

    monkeypatch.setattr(settings, "api_token", "t0k")
    assert client.post("/api/demo").status_code == 401
    assert client.post("/api/demo", headers={"X-API-Token": "t0k"}).status_code == 200
