"""LÜMEN Author: drafts a spec from an idea and never runs without a model."""
import pytest

from lumen.generate import generate_spec


def test_generator_returns_markdown_and_treats_idea_as_data(cfg):
    from lumen.llm.client import MockClient

    seen = {}

    def responder(step, user):
        seen["user"] = user
        return {"title": "Кэшбэк", "markdown": "## Цели\n* **Ф-1.** Система должна начислять кэшбэк 1%."}

    res = generate_spec("Кэшбэк 1% за покупки в кафе", client=MockClient("m", cfg, responder=responder))
    assert res.markdown.startswith("# Кэшбэк") and "Ф-1" in res.markdown
    assert "<idea>" in seen["user"] and "</idea>" in seen["user"]


def test_generator_rejects_empty_idea(cfg):
    with pytest.raises(ValueError):
        generate_spec("  кэш ", client=object())


def test_generate_endpoint_validates_input():
    from fastapi.testclient import TestClient

    from lumen.api.app import app

    r = TestClient(app).post("/api/generate", json={"idea": "x"})
    assert r.status_code in (401, 422)
