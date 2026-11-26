import re
from pathlib import Path

from lumen.compare import compare
from lumen.engine.pipeline import run_audit
from lumen.translate import detect_target, markdown_to_docx, translate_document, wants_translation

ROOT = Path(__file__).resolve().parent.parent


def test_translate_preserves_structure(tmp_path, cfg):
    seen = []

    def responder(step, user):
        src = re.search(r"<source>\n(.*)\n</source>", user, re.S).group(1)
        seen.append(src)
        return {"text": src.replace("Функциональные требования", "Functional requirements").replace("Клиент", "Client")}

    p = tmp_path / "r.md"
    p.write_text("# ТЗ\n\n## Функциональные требования\n* **F-1.** Клиент задаёт порог 1 000 ₸.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
                 encoding="utf-8")
    tr = translate_document(p, "en", cfg=cfg, responder=responder)
    assert "## Functional requirements" in tr.markdown and "F-1." in tr.markdown and "| --- | --- |" in tr.markdown
    from docx import Document
    import io

    d = Document(io.BytesIO(markdown_to_docx(tr.markdown)))
    assert any("Functional requirements" in x.text for x in d.paragraphs) and len(d.tables) == 1


def test_translation_intents():
    assert wants_translation("переведи на английский") and detect_target("переведи на английский") == "en"
    assert detect_target("қазақшаға аудар") == "kk" and detect_target("translate to russian") == "ru"


def test_compare_versions(tmp_path, cfg):
    a = run_audit(ROOT / "docs" / "requirements.md", cfg=cfg)
    text = (ROOT / "docs" / "requirements.md").read_text(encoding="utf-8").replace("| **REST type** | GET |", "| **REST type** | PUT |")
    p = tmp_path / "v2.md"
    p.write_text(text, encoding="utf-8")
    b = run_audit(p, cfg=cfg)
    c = compare(a, b)
    assert any("GET" in f["title"] for f in c["fixed"])
    assert c["remaining"] and c["delta_quality"] >= 0


def test_api_compare_and_docx(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from lumen import service
    from lumen.config import Settings

    s = Settings()
    s.data_dir = tmp_path
    s.provider = "offline"
    monkeypatch.setattr(service, "_service", service.AuditService(s))
    from lumen.api.app import app

    c = TestClient(app)
    r = c.post("/api/translate/docx", json={"markdown": "# Title\n\n* item"})
    assert r.status_code == 200 and r.content[:2] == b"PK"
    files = {"file": ("r.md", "# S\n\n## Ф\n* **F-1.** Клиент задаёт порог.".encode())}
    assert c.post("/api/translate", files=files, data={"target": "en"}).status_code == 422  # no model offline → clear error
