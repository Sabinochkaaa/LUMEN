import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LLM_PROVIDER", "offline")
for k in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "SUPABASE_URL", "TELEGRAM_BOT_TOKEN", "LUMEN_API_TOKEN"):
    os.environ.pop(k, None)

FIX = ROOT / "tests" / "fixtures"


@pytest.fixture
def fx():
    return FIX


@pytest.fixture
def cfg(tmp_path):
    from lumen.config import Settings

    s = Settings()
    s.data_dir = tmp_path
    s.provider = "offline"
    s.max_retries = 2
    return s


@pytest.fixture
def make_pdf(tmp_path):
    def _make(text: str, name: str = "doc.pdf") -> Path:
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        y = 60
        for line in text.split("\n"):
            if os.path.exists(font):
                page.insert_text((50, y), line, fontsize=11, fontfile=font, fontname="dv")
            else:
                page.insert_text((50, y), line, fontsize=11)
            y += 16
        p = tmp_path / name
        doc.save(p)
        return p
    return _make
