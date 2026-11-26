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


def test_public_audits_and_admin_login(client, monkeypatch):
    from lumen.config import settings
    from lumen.security import limiter

    limiter._hits.clear()
    monkeypatch.setattr(settings, "api_token", "")
    monkeypatch.setattr(settings, "admin_password_raw", "S3cret-admin")
    monkeypatch.setattr(settings, "env", "production")
    files = {"file": ("r.md", "# S\n\n## Функциональные\n* **F-1.** Тест требования.".encode())}
    # guests can run audits (public mode) but cannot delete
    assert client.post("/api/audits", files=files).status_code == 200
    assert client.delete("/api/audits/x").status_code == 401
    assert client.get("/api/auth/me").json() == {"admin": False, "login_enabled": True, "public_audits": True}
    # wrong password, then right password → HttpOnly session cookie
    assert client.post("/api/auth/login", json={"password": "nope"}).status_code == 401
    r = client.post("/api/auth/login", json={"password": "S3cret-admin"})
    assert r.status_code == 200 and "httponly" in r.headers["set-cookie"].lower() and "samesite=strict" in r.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").json()["admin"] is True
    # CSRF guard: cookie-authenticated writes need the frontend header
    assert client.delete("/api/audits/x").status_code == 401
    assert client.delete("/api/audits/x", headers={"X-Requested-With": "lumen"}).status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["admin"] is False
    # scripts can still use the header token
    assert client.delete("/api/audits/x", headers={"X-API-Token": "S3cret-admin"}).status_code == 200
    # closed mode: guests cannot run audits
    monkeypatch.setattr(settings, "public_audits", False)
    assert client.post("/api/audits", files=files).status_code == 401
    assert client.post("/api/audits", files=files, headers={"X-API-Token": "S3cret-admin"}).status_code == 200
    assert client.post("/api/demo").status_code == 200  # demo stays public
    limiter._hits.clear()


def test_login_bruteforce_limit(client, monkeypatch):
    from lumen.config import settings
    from lumen.security import limiter

    limiter._hits.clear()
    monkeypatch.setattr(settings, "admin_password_raw", "S3cret-admin")
    codes = [client.post("/api/auth/login", json={"password": f"x{i}"}).status_code for i in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429
    limiter._hits.clear()


def test_private_mode_and_delete_rules(client, monkeypatch):
    from lumen.config import settings

    monkeypatch.setattr(settings, "private_mode", True)
    monkeypatch.setattr(settings, "admin_password_raw", "t0k")
    monkeypatch.setattr(settings, "env", "production")
    assert client.get("/api/audits").status_code == 401
    assert client.get("/api/audits", headers={"X-API-Token": "t0k"}).status_code == 200
    assert client.get("/api/health").status_code == 200
    monkeypatch.setattr(settings, "private_mode", False)
    monkeypatch.setattr(settings, "admin_password_raw", "")
    monkeypatch.setattr(settings, "api_token", "")
    assert client.delete("/api/audits/x").status_code == 403  # production without a password: deletion disabled


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_upload_content_validation(client):
    assert client.post("/api/audits", files={"file": ("evil.pdf", b"MZ\x90\x00 not a pdf")}).status_code == 422
    assert client.post("/api/audits", files={"file": ("fake.docx", b"hello")}).status_code == 422
    r = client.post("/api/audits", files={"file": ("fake.pdf", b"just text")})
    assert r.status_code == 422 and "не является PDF" in r.json()["detail"]


def test_rate_limit(client, monkeypatch):
    from lumen.config import settings
    from lumen.security import limiter

    limiter._hits.clear()
    monkeypatch.setattr(settings, "rate_audits_per_hour", 2)
    codes = [client.post("/api/demo").status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    limiter._hits.clear()
