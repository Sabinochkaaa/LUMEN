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


def test_forged_forwarded_for_does_not_bypass_login_limit(client, monkeypatch):
    """Attacker rotates a fake X-Forwarded-For on every try; the proxy appends the real address last."""
    from lumen.config import settings
    from lumen.security import limiter

    limiter._hits.clear()
    monkeypatch.setattr(settings, "admin_password_raw", "S3cret-admin")
    codes = [client.post("/api/auth/login", json={"password": f"x{i}"},
                         headers={"x-forwarded-for": f"10.0.0.{i}, 203.0.113.7"}).status_code for i in range(6)]
    assert codes[5] == 429
    limiter._hits.clear()


def test_only_author_or_admin_answers_questions(client, monkeypatch):
    from lumen.config import settings

    r = client.post("/api/demo").json()
    aid, key = r["audit_id"], r["edit_key"]
    a = wait(client, aid)
    qid = a["questions"][0]["id"]
    monkeypatch.setattr(settings, "admin_password_raw", "S3cret-admin")
    monkeypatch.setattr(settings, "public_audits", True)
    url = f"/api/audits/{aid}/questions/{qid}"
    assert client.patch(url, json={"status": "clarified"}).status_code == 403
    assert client.patch(url, json={"status": "clarified"}, headers={"x-edit-key": "0" * 32}).status_code == 403
    other = client.post("/api/demo").json()["edit_key"]  # key of another audit must not work here
    assert client.patch(url, json={"status": "clarified"}, headers={"x-edit-key": other}).status_code == 403
    assert client.patch(url, json={"status": "clarified"}, headers={"x-edit-key": key}).status_code == 200
    assert client.patch(url, json={"answer": "x" * 5000}, headers={"x-edit-key": key}).status_code == 422


def test_edge_cases_ids_bodies_and_files(client):
    assert client.get("/api/audits/..%2F..%2Fetc/report.md").status_code == 404
    assert client.get("/api/audits/" + "a" * 65).status_code == 404
    assert client.get("/api/audits/nope,or(id.neq.0)").status_code == 404
    big = client.post("/api/audits", content=b"x", headers={"content-length": str(30 * 1024 * 1024),
                                                              "content-type": "multipart/form-data; boundary=x"})
    assert big.status_code == 413
    for name, data in [("a.pdf", b"not a pdf at all"), ("a.docx", b"PK\x03\x04broken"), ("a.md", b"   \n\t"),
                       ("a.png", b"\x89PNG\r\n\x1a\ngarbage"), ("a.exe", b"MZ\x90\x00")]:
        assert client.post("/api/audits", files={"file": (name, data)}).status_code in (413, 415, 422), name


def test_report_never_leaks_exception_text(client, monkeypatch):
    from lumen.report import export

    aid = client.post("/api/demo").json()["audit_id"]
    wait(client, aid)
    monkeypatch.setattr(export, "render", lambda r, fmt: (_ for _ in ()).throw(RuntimeError("/srv/secret/path")))
    r = client.get(f"/api/audits/{aid}/report.pdf")
    assert r.status_code == 500 and "/srv/secret" not in r.text
