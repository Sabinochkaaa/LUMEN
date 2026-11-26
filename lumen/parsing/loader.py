"""Document Parser: PDF / DOCX / MD / TXT → normalized lines (markdown-like) with source positions.

Every format is converted into the same intermediate representation — a list of `Line`
objects in a markdown-like syntax (headings `#`, lists `*`, tables `|`) — so that a single
structural parser (`structure.py`) builds blocks for all formats. The original file is
never modified.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from ..models import Document, Line
from .structure import build_blocks

SUPPORTED = {".md", ".markdown", ".txt", ".pdf", ".docx"}
FORMATS = ["pdf", "docx", "md", "txt"]


class DocumentError(Exception):
    """Raised when a document can not be read; message is user-facing (Russian)."""


def load_document(path: str | Path, display_name: str | None = None) -> Document:
    p = Path(path)
    if not p.exists():
        raise DocumentError(f"Файл не найден: {p}")
    if not p.is_file():
        raise DocumentError(f"Путь не является файлом: {p}")
    ext = p.suffix.lower()
    if ext not in SUPPORTED:
        raise DocumentError(
            f"Формат «{ext or 'без расширения'}» не поддерживается. Поддерживаются: PDF, DOCX, MD, TXT."
        )
    raw = p.read_bytes()
    if not raw.strip():
        raise DocumentError("Документ пуст — нечего проверять.")
    sha = hashlib.sha256(raw).hexdigest()
    warnings: list[str] = []
    pages = None
    if ext in (".md", ".markdown"):
        lines = _text_lines(_decode(raw))
        fmt = "markdown"
    elif ext == ".txt":
        lines = _txt_to_lines(_decode(raw))
        fmt = "text"
    elif ext == ".pdf":
        lines, pages, warnings = _pdf_lines(raw)
        fmt = "pdf"
    else:
        lines, warnings = _docx_lines(p)
        fmt = "docx"

    if not any(ln.text.strip() for ln in lines):
        raise DocumentError(
            "В документе не найден текст. Если это скан, установите OCR (pytesseract + tesseract) — см. README."
        )
    blocks = build_blocks(lines)
    title = next((b.text for b in blocks if b.kind == "heading"), display_name or p.name)
    return Document(
        name=display_name or p.name,
        path=str(p),
        format=fmt,
        sha256=sha,
        lines=lines,
        blocks=blocks,
        pages=pages,
        title=title,
        warnings=warnings,
    )


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _text_lines(text: str, origin: str = "") -> list[Line]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return [Line(no=i + 1, text=t.replace("\t", "    "), origin=origin) for i, t in enumerate(text.split("\n"))]


_TXT_HEADING = re.compile(r"^(\d+(\.\d+)*\.?|[IVX]+\.|Раздел\s+\d+|Глава\s+\d+)\s+\S.{0,80}$")


def _txt_to_lines(text: str) -> list[Line]:
    """Plain text: promote short numbered/ALL-CAPS lines to headings, keep everything else."""
    lines = _text_lines(text)
    for ln in lines:
        s = ln.text.strip()
        if not s or s.startswith(("#", "|", "*", "-")):
            continue
        is_caps = len(s) < 90 and s.upper() == s and any(c.isalpha() for c in s) and not s.endswith(".")
        if is_caps or (_TXT_HEADING.match(s) and not s.endswith((".", ";", ",")) and len(s.split()) <= 10):
            depth = s.split()[0].count(".") + 1 if s[0].isdigit() else 2
            ln.text = "#" * min(max(depth, 1) + 1, 6) + " " + s
    return lines


def _pdf_lines(raw: bytes) -> tuple[list[Line], int, list[str]]:
    try:
        import pymupdf  # type: ignore
    except Exception:  # pragma: no cover
        try:
            import fitz as pymupdf  # type: ignore
        except Exception as e:
            raise DocumentError("Для чтения PDF установите PyMuPDF (pip install pymupdf).") from e
    try:
        doc = pymupdf.open(stream=raw, filetype="pdf")
    except Exception as e:
        raise DocumentError(f"PDF повреждён или не читается: {e}") from e
    if doc.needs_pass:
        raise DocumentError("PDF защищён паролем — снимите защиту и повторите.")

    warnings: list[str] = []
    out: list[str] = []
    meta: list[tuple[int, str]] = []
    # font size statistics for heading detection
    sizes: list[float] = []
    for page in doc:
        for b in page.get_text("dict").get("blocks", []):
            for l in b.get("lines", []):
                for s in l.get("spans", []):
                    if s.get("text", "").strip():
                        sizes.append(round(s.get("size", 0), 1))
    body = sorted(sizes)[len(sizes) // 2] if sizes else 10.0

    for pno, page in enumerate(doc, start=1):
        items: list[tuple[float, list[str]]] = []
        tables_bbox = []
        try:
            tabs = page.find_tables()
            for t in tabs.tables:
                rows = t.extract()
                if not rows or len(rows[0]) < 2:
                    continue
                tables_bbox.append(pymupdf.Rect(t.bbox))
                md = []
                for i, r in enumerate(rows):
                    cells = [(c or "").replace("\n", " ").strip() for c in r]
                    md.append("| " + " | ".join(cells) + " |")
                    if i == 0:
                        md.append("|" + "|".join([" --- "] * len(cells)) + "|")
                items.append((t.bbox[1], [""] + md + [""]))
        except Exception:
            pass
        page_text = 0
        for b in page.get_text("dict").get("blocks", []):
            if b.get("type") != 0:
                continue
            rect = pymupdf.Rect(b["bbox"])
            if any(rect.intersects(tb) and (rect & tb).get_area() > 0.6 * rect.get_area() for tb in tables_bbox):
                continue
            for l in b.get("lines", []):
                spans = [s for s in l.get("spans", []) if s.get("text", "").strip()]
                if not spans:
                    continue
                text = "".join(s["text"] for s in l["spans"]).strip()
                page_text += len(text)
                size = max(s.get("size", 0) for s in spans)
                bold = all("bold" in s.get("font", "").lower() or (s.get("flags", 0) & 16) for s in spans)
                if size >= body * 1.25 and len(text) < 120:
                    text = ("# " if size >= body * 1.6 else "## ") + text
                elif bold and len(text) < 90 and not text.endswith("."):
                    text = "### " + text
                elif re.match(r"^[•●▪◦–]\s*", text):
                    text = "* " + re.sub(r"^[•●▪◦–]\s*", "", text)
                items.append((l["bbox"][1], [text]))
            items.append((b["bbox"][3] + 0.01, [""]))
        if page_text < 20 and not tables_bbox:
            ocr = _ocr_page(page)
            if ocr:
                items = [(0, ocr.split("\n"))]
                warnings.append(f"Страница {pno}: текст получен через OCR — возможны неточности распознавания.")
            else:
                warnings.append(
                    f"Страница {pno}: текстовый слой не найден (вероятно, скан). OCR недоступен — страница пропущена."
                )
        items.sort(key=lambda x: x[0])
        for _, rows in items:
            for r in rows:
                out.append(r)
                meta.append((pno, f"стр. {pno}"))
    lines = [Line(no=i + 1, text=t, page=meta[i][0], origin=meta[i][1]) for i, t in enumerate(out)]
    return lines, doc.page_count, warnings


def _ocr_page(page) -> str:
    try:
        import io

        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore

        pix = page.get_pixmap(dpi=200)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        return pytesseract.image_to_string(img, lang="rus+eng")
    except Exception:
        return ""


def _docx_lines(p: Path) -> tuple[list[Line], list[str]]:
    try:
        import docx  # type: ignore
        from docx.table import Table  # type: ignore
        from docx.text.paragraph import Paragraph  # type: ignore
    except Exception as e:  # pragma: no cover
        raise DocumentError("Для чтения DOCX установите python-docx.") from e
    try:
        d = docx.Document(str(p))
    except Exception as e:
        raise DocumentError(f"DOCX повреждён или не читается: {e}") from e

    out: list[tuple[str, str]] = []
    para_no = 0
    tbl_no = 0
    for child in d.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, d)
            para_no += 1
            text = para.text.strip()
            style = (para.style.name if para.style is not None else "").lower()
            if not text:
                out.append(("", f"абзац {para_no}"))
                continue
            m = re.search(r"(heading|заголовок)\s*(\d)", style)
            if m:
                text = "#" * int(m.group(2)) + " " + text
            elif style.startswith("title"):
                text = "# " + text
            elif "list" in style or child.find(".//{*}numPr") is not None:
                text = "* " + text
            out.append((text, f"абзац {para_no}"))
            out.append(("", f"абзац {para_no}"))
        elif tag == "tbl":
            tbl_no += 1
            table = Table(child, d)
            out.append(("", f"таблица {tbl_no}"))
            for ri, row in enumerate(table.rows):
                cells = []
                for c in row.cells:
                    cells.append(c.text.replace("\n", " ").replace("|", "/").strip())
                out.append(("| " + " | ".join(cells) + " |", f"таблица {tbl_no}, строка {ri + 1}"))
                if ri == 0:
                    out.append(("|" + "|".join([" --- "] * len(cells)) + "|", f"таблица {tbl_no}"))
            out.append(("", f"таблица {tbl_no}"))
    lines = [Line(no=i + 1, text=t, origin=o) for i, (t, o) in enumerate(out)]
    return lines, []
