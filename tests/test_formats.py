"""Input formats (HTML, RTF, image OCR) and report exports (PDF, DOCX, XLSX)."""
import io
import shutil
from pathlib import Path

import pytest

from lumen.engine.pipeline import finalize, run_audit
from lumen.parsing.loader import load_document

ROOT = Path(__file__).resolve().parent.parent


def test_html_input(tmp_path, cfg):
    p = tmp_path / "req.html"
    p.write_text("<html><body><h1>ТЗ</h1><h2>Функциональные требования</h2><ul><li>FR-1. Система быстро сохраняет порог.</li>"
                 "<li>FR-2. Клиент видит сумму за месяц.</li><li>FR-3. Клиент получает push.</li></ul></body></html>", encoding="utf-8")
    res = run_audit(p, cfg=cfg)
    assert {"FR-1", "FR-2", "FR-3"} <= {r.source_id for r in res.requirements}
    assert any(f.rule_id == "R-VAGUE" for f in res.findings)


def test_rtf_input(tmp_path):
    p = tmp_path / "req.rtf"
    p.write_bytes(b"{\\rtf1\\ansi\\ansicpg1251{\\fonttbl{\\f0 Arial;}}\\f0 FR-1. \\'d1\\'e8\\'f1\\'f2\\'e5\\'ec\\'e0 "
                  b"\\'f1\\'ee\\'f5\\'f0\\'e0\\'ed\\'ff\\'e5\\'f2 \\'ef\\'ee\\'f0\\'ee\\'e3.\\par FR-2. Test\\par}")
    doc = load_document(p)
    assert "Система сохраняет порог." in "\n".join(l.text for l in doc.lines)
    assert "Arial" not in "\n".join(l.text for l in doc.lines)


@pytest.mark.skipif(not shutil.which("tesseract"), reason="tesseract не установлен")
def test_image_ocr(tmp_path):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1400, 260), "white")
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34)
    d = ImageDraw.Draw(img)
    d.text((30, 40), "FR-1. Система сохраняет порог клиента.", fill="black", font=font)
    d.text((30, 140), "FR-2. Клиент получает уведомление.", fill="black", font=font)
    p = tmp_path / "scan.png"
    img.save(p)
    doc = load_document(p)
    text = "\n".join(l.text for l in doc.lines)
    assert "порог" in text and doc.format == "image" and doc.warnings


def test_exports(tmp_path, cfg):
    from docx import Document
    from openpyxl import load_workbook

    from lumen.demo import demo_responder

    res = run_audit(ROOT / "examples" / "demo_requirements.md", provider="mock", cfg=cfg, responder=demo_responder, demo=True)
    paths = finalize(res, tmp_path / "r.md", formats=("md", "pdf", "docx", "xlsx"))
    pdf = paths["pdf"].read_bytes()
    assert pdf.startswith(b"%PDF") and len(pdf) > 5000
    import pymupdf

    text = "".join(pg.get_text() for pg in pymupdf.open(stream=pdf, filetype="pdf"))
    assert "Исправьте в первую очередь" in text and "Нарезка требований" in text and "F-001" in text
    doc = Document(paths["docx"])
    body = "\n".join(p.text for p in doc.paragraphs)
    assert "Как агент нарезал требования" in body and "F-001" in body
    wb = load_workbook(paths["xlsx"])
    assert wb.sheetnames == ["Сводка", "Требования", "Дефекты", "Вопросы", "FinTech"]
    assert wb["Дефекты"].max_row == len(res.findings) + 1
