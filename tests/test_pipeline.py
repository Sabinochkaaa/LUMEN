"""LÜMEN Core test-suite. Runs without any paid key: offline rules + Mock LLM."""
from pathlib import Path

import pytest

from lumen.engine.pipeline import AuditError, finalize, run_audit
from lumen.llm.client import LLMError
from lumen.parsing.loader import DocumentError, load_document

ROOT = Path(__file__).resolve().parent.parent

GOOD_MD = """# Платёжный сервис

## Функциональные требования
* **FR-1.** Клиент задаёт лимит от 1 000 до 100 000 ₸ включительно.
* **FR-2.** Система должна быстро проверять лимит при каждой покупке.
* **FR-3.** При превышении лимита клиент получает push-уведомление.

## Нефункциональные требования
* **NFR-1.** Уведомление отправляется в течение 5 секунд после события.

## Критерии приемки

| Условие | Действие | Результат |
| :--- | :--- | :--- |
| Лимит 10 000 ₸, расходы 9 000 ₸ | Покупка 2 000 ₸ | Один push |
"""


def write(tmp_path, text, name="req.md"):
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


def rules(result, rule_id):
    return [f for f in result.findings if f.rule_id == rule_id]


# 1 ---------------------------------------------------------------- correct PDF
def test_pdf_document(make_pdf, cfg):
    p = make_pdf("Требования к сервису\n\nФункциональные требования\nFR-1. Система сохраняет порог клиента.\n"
                 "FR-2. Система быстро отправляет уведомление.\nFR-3. Клиент видит сумму расходов за месяц.")
    doc = load_document(p)
    assert doc.format == "pdf" and doc.pages == 1
    assert all(l.page == 1 for l in doc.lines if l.text)
    res = run_audit(p, cfg=cfg)
    assert res.scores.total_requirements >= 3
    vague = [f for f in res.findings if f.rule_id == "R-VAGUE"]
    assert vague and vague[0].loc.page == 1  # page number comes from the file, not from a model


# 2 ---------------------------------------------------------------- DOCX
def test_docx_document(tmp_path, cfg):
    import docx

    d = docx.Document()
    d.add_heading("Требования", level=1)
    d.add_heading("Функциональные требования", level=2)
    for t in ("FR-1. Клиент задаёт порог от 1 000 до 10 000 ₸.", "FR-2. Система по возможности уведомляет клиента.",
              "FR-3. Порог хранится в тиынах, отображается в тенге."):
        d.add_paragraph(t, style="List Bullet")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text = "Поле", "Значение"
    t.cell(1, 0).text, t.cell(1, 1).text = "Версия", "1.0"
    p = tmp_path / "req.docx"
    d.save(p)
    res = run_audit(p, cfg=cfg)
    assert res.passport.document_format == "docx"
    assert {r.source_id for r in res.requirements} >= {"FR-1", "FR-2", "FR-3"}
    assert rules(res, "R-VAGUE") and rules(res, "R-UNITS")


# 3 ---------------------------------------------------------------- empty
def test_empty_document(tmp_path, cfg):
    p = write(tmp_path, "   \n\n")
    with pytest.raises(AuditError, match="пуст"):
        run_audit(p, cfg=cfg)


# 4 ---------------------------------------------------------------- corrupted PDF
def test_corrupted_pdf(tmp_path, cfg):
    p = tmp_path / "bad.pdf"
    p.write_bytes(b"%PDF-1.7\n\x00\x01 this is not a pdf body")
    with pytest.raises(AuditError, match="PDF"):
        run_audit(p, cfg=cfg)


def test_unsupported_and_missing(tmp_path, cfg):
    with pytest.raises(AuditError, match="не найден"):
        run_audit(tmp_path / "nope.md", cfg=cfg)
    p = tmp_path / "x.xlsx"
    p.write_bytes(b"data")
    with pytest.raises(AuditError, match="не поддерживается"):
        run_audit(p, cfg=cfg)


# 5 ---------------------------------------------------------------- no identifiers
def test_document_without_ids(tmp_path, cfg):
    text = ("# Сервис\n\n## Функциональные требования\nСистема сохраняет настройки клиента.\n\n"
            "Система показывает историю операций за месяц.\n\nСистема отправляет уведомление при достижении порога.\n")
    res = run_audit(write(tmp_path, text), cfg=cfg)
    assert [r.id for r in res.requirements] == ["REQ-001", "REQ-002", "REQ-003"]
    assert all(r.source_id_kind != "explicit" for r in res.requirements)
    assert all(r.quote for r in res.requirements)  # quote preserved for self-assigned IDs
    assert rules(res, "SET-IDS")


# 6 ---------------------------------------------------------------- ambiguity
def test_ambiguous_wording(tmp_path, cfg):
    res = run_audit(write(tmp_path, GOOD_MD), cfg=cfg)
    f = rules(res, "R-VAGUE")
    assert f and "быстро" in f[0].title
    assert f[0].quote and "быстро" in f[0].quote
    assert f[0].loc.line_start == 5
    assert any("быстро" in q.question for q in res.questions)


# 7 ---------------------------------------------------------------- contradictions (LLM, grounded)
def test_contradiction_is_grounded(tmp_path, cfg):
    def responder(step, user):
        if step == "set:consistency":
            return {"issues": [{"kind": "conflict", "severity": "CRITICAL", "title": "Лимит противоречит критерию",
                                "req_ids": ["REQ-001", "REQ-005"], "quotes": ["от 1 000 до 100 000 ₸ включительно", "Покупка 2 000 ₸"],
                                "problem": "Тестовое противоречие", "confidence": 0.9}],
                    "relations": [{"source": "REQ-005", "target": "REQ-001", "type": "refines", "confident": True}]}
        if step == "verify":
            return {"verdicts": [{"id": "V1", "verdict": "keep"}]}
        return {}

    res = run_audit(write(tmp_path, GOOD_MD), provider="mock", cfg=cfg, responder=responder)
    c = [f for f in res.findings if f.rule_id == "LLM-conflict"][0]
    assert c.status == "confirmed" and c.severity == "CRITICAL"
    assert "[строка 4]" in c.quote and c.loc.line_start == 4
    assert res.scores.contradictions >= 1 and res.readiness == "NOT READY"
    assert any(r.type == "conflicts_with" for r in res.relations)


# hallucination defence ----------------------------------------------------------
def test_fabricated_quote_and_ids_are_rejected(tmp_path, cfg):
    def responder(step, user):
        if step.startswith("requirements"):
            return {"requirements": [
                {"id": "REQ-001", "findings": [{"criterion": "verifiable", "severity": "HIGH", "title": "Выдумка",
                                                "quote": "система обязана работать на квантовом компьютере", "problem": "x"}]},
                {"id": "REQ-999", "findings": [{"criterion": "complete", "severity": "HIGH", "title": "Нет такого",
                                                "quote": "Клиент задаёт лимит", "problem": "x"}]}]}
        return {}

    res = run_audit(write(tmp_path, GOOD_MD), provider="mock", cfg=cfg, responder=responder)
    fake = [f for f in res.findings if f.title == "Выдумка"][0]
    assert fake.status == "needs_review"
    assert "квантов" not in fake.quote  # model quote replaced by the real requirement text
    assert not [f for f in res.findings if f.title == "Нет такого"]  # unknown ID dropped
    assert res.scores.findings_total == len([f for f in res.findings if f.status == "confirmed"])


# 8 ---------------------------------------------------------------- duplicates
def test_duplicate_requirements(tmp_path, cfg):
    text = ("# Сервис\n\n## Функциональные требования\n* **F-1.** При изменении порога накопленная сумма расходов сохраняется "
            "без обнуления.\n* **F-2.** Клиент задаёт порог.\n\n## Правила API\n* **A-1.** При изменении порога накопленная "
            "сумма расходов сохраняется без обнуления.\n")
    res = run_audit(write(tmp_path, text), cfg=cfg)
    dup = rules(res, "SET-DUP")
    assert dup and set(dup[0].req_ids) == {"REQ-001", "REQ-003"}
    assert any(r.type == "duplicates" for r in res.relations)


# 9 ---------------------------------------------------------------- incomplete
def test_incomplete_requirements(tmp_path, cfg):
    text = GOOD_MD + "\n## Требования к тестированию\nзаполняется позже\n\n## Интеграция\nRequest URL: Dev: /a . Prod: —\n"
    res = run_audit(write(tmp_path, text), cfg=cfg)
    assert rules(res, "SET-PLACEHOLDER")[0].severity == "HIGH"
    assert any("Prod" in f.title for f in rules(res, "R-EMPTY-VALUE"))


# 10 ---------------------------------------------------------------- missing acceptance criteria (LLM gap)
def test_missing_acceptance_criteria(tmp_path, cfg):
    text = "# S\n\n## Функциональные требования\n* **F-1.** Клиент задаёт порог.\n* **F-2.** Клиент получает push.\n* **F-3.** Клиент видит сумму.\n"

    def responder(step, user):
        if step == "set:completeness":
            return {"issues": [{"kind": "gap", "criterion": "set_validatable", "severity": "HIGH",
                                "title": "Нет критериев приёмки", "req_ids": ["F-2"], "quotes": ["Клиент получает push."],
                                "problem": "Для функциональных требований нет критериев приёмки", "confidence": 0.9}]}
        return {}

    res = run_audit(write(tmp_path, text), provider="mock", cfg=cfg, responder=responder)
    gap = [f for f in res.findings if f.title == "Нет критериев приёмки"][0]
    assert gap.req_ids == ["REQ-002"]  # document ID F-2 mapped to report ID
    assert gap.status == "confirmed" and res.scores.unverifiable >= 1


# 11 ---------------------------------------------------------------- API contract
def test_api_contract_problems(cfg):
    res = run_audit(ROOT / "docs" / "requirements.md", cfg=cfg)
    ids = {f.rule_id for f in res.findings}
    assert {"API-GET-MUTATION", "API-SUCCESS-WITH-ERROR", "API-TYPE-MISMATCH", "API-UNDEFINED-STATUS", "R-UNITS"} <= ids
    assert {"Ф-1", "Ф-2", "Ф-3", "Ф-4"} <= {r.source_id for r in res.requirements}
    for f in res.findings:  # every located quote really exists at that line
        if f.loc and f.quote and f.source == "rule":
            src = " ".join(l.text for l in res.source[f.loc.line_start - 1:f.loc.line_end])
            assert f.quote.split()[0].strip("«»*`|") in src.replace("**", "").replace("`", "")


# 12 ---------------------------------------------------------------- insufficient data
def test_insufficient_data(tmp_path, cfg):
    res = run_audit(write(tmp_path, "# S\n\n## Функциональные требования\n* **F-1.** Клиент задаёт порог расходов.\n"), cfg=cfg)
    assert res.readiness == "INSUFFICIENT DATA"


def test_offline_is_never_ready(cfg):
    res = run_audit(ROOT / "docs" / "requirements.md", cfg=cfg)
    assert res.passport.mode == "offline" and res.readiness in ("INSUFFICIENT DATA", "NOT READY")
    assert any("офлайн" in w for w in res.warnings)


# 13 ---------------------------------------------------------------- LLM API error
def test_llm_api_error_is_handled(tmp_path, cfg):
    res = run_audit(write(tmp_path, GOOD_MD), provider="mock", cfg=cfg,
                    responder=lambda step, user: LLMError("HTTP 503 overloaded"))
    assert res.findings  # deterministic part still delivered
    assert any("ошибкой" in w for w in res.warnings)
    assert res.readiness == "INSUFFICIENT DATA"


# 14 ---------------------------------------------------------------- invalid model answer + retry
def test_invalid_json_retry(tmp_path, cfg):
    calls = {"n": 0}

    def responder(step, user):
        if step.startswith("requirements"):
            calls["n"] += 1
            if calls["n"] == 1:
                return "это не JSON {"
            if "НЕ ПРОШЁЛ ВАЛИДАЦИЮ" in user:
                return {"requirements": [{"id": "REQ-001", "criteria": {"unambiguous": "ok"}}]}
        return {}

    res = run_audit(write(tmp_path, GOOD_MD), provider="mock", cfg=cfg, responder=responder)
    assert calls["n"] == 2 and res.passport.llm_failures >= 1
    a = next(x for x in res.assessments if x.req_id == "REQ-001")
    assert a.criteria["unambiguous"] == "ok"


def test_invalid_json_gives_up_safely(tmp_path, cfg):
    res = run_audit(write(tmp_path, GOOD_MD), provider="mock", cfg=cfg, responder=lambda s, u: "{broken")
    assert any("невалидный" in w for w in res.warnings)


# 15 ---------------------------------------------------------------- report
def test_report_generation(tmp_path, cfg):
    from lumen.demo import demo_responder

    res = run_audit(ROOT / "examples" / "demo_requirements.md", provider="mock", cfg=cfg, responder=demo_responder, demo=True)
    paths = finalize(res, tmp_path / "out" / "report.md")
    md = paths["md"].read_text(encoding="utf-8")
    for section in ("Паспорт прогона", "Как агент нарезал требования", "Проверка каждого требования",
                    "Проверка всего набора", "Вопросы к владельцу", "Сводка", "Итог", "ДЕМОНСТРАЦИОННЫЙ"):
        assert section in md
    assert "| ID в отчёте | ID в документе |" in md
    assert paths["html"].read_text(encoding="utf-8").startswith("<!DOCTYPE html>")
    assert paths["json"].exists()
    crit = [f for f in res.findings if f.severity == "CRITICAL"]
    assert crit and crit[0].loc is not None  # every critical defect points to a place in the document


def test_secrets_are_masked():
    from lumen.llm.client import _mask

    assert "sk-ant-SECRET123456" not in _mask("key sk-ant-SECRET123456 leaked", ["sk-ant-SECRET123456"])


def test_failed_parallel_step_is_retried(tmp_path, cfg):
    calls = {"set:consistency": 0}

    def responder(step, user):
        if step == "set:consistency":
            calls[step] += 1
            if calls[step] == 1:
                return LLMError("HTTP 429 burst")
            return {"issues": [{"kind": "conflict", "severity": "HIGH", "title": "Повтор сработал",
                                "quotes": ["Клиент задаёт лимит от 1 000 до 100 000 ₸ включительно."], "problem": "x"}]}
        return {}

    res = run_audit(write(tmp_path, GOOD_MD), provider="mock", cfg=cfg, responder=responder)
    assert calls["set:consistency"] == 2
    assert any(f.title == "Повтор сработал" for f in res.findings)
    assert any("повторно" in w for w in res.warnings) and not any("ошибкой" in w for w in res.warnings)


def test_same_document_reuses_result(tmp_path, monkeypatch):
    from lumen.config import Settings
    from lumen.service import AuditService
    cfg = Settings(); cfg.data_dir = str(tmp_path); cfg.cache_hours = 24
    svc = AuditService(cfg)
    doc = tmp_path / "a.md"; doc.write_text("# ТЗ\n\n1. Система должна быстро работать.\n", encoding="utf-8")
    calls = []
    import lumen.service as s
    real = s.run_audit
    def fake(*a, **k):
        calls.append(1); r = real(*a, **k)
        r.passport.mode = "llm"; return r
    monkeypatch.setattr(s, "run_audit", fake)
    r1 = svc.run_sync(doc, "a.md", provider="offline")
    r2 = svc.run_sync(doc, "a.md", provider="offline")
    assert len(calls) == 1 and r1.id != r2.id and r1.scores.quality_index == r2.scores.quality_index
