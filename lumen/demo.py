"""Demo mode: a scripted, clearly-labelled stand-in for the LLM on examples/demo_requirements.md.

Used by `lumen --demo`, the dashboard «Demo» button and the test-suite. Results are always flagged
`demo=True` / mode «mock» and are never presented as a review of the organizers' document.
Quotes below are verbatim fragments of the demo document — they pass the same evidence check as a
real model answer.
"""
from __future__ import annotations

import re


def _ids(user: str) -> dict[str, str]:
    """Map document IDs (FR-3) → report IDs (REQ-00N) from the payload the pipeline sent."""
    out = {}
    for m in re.finditer(r'"id":\s*"(REQ-\d+)",\s*"source_id":\s*"([^"]+)"', user):
        out[m.group(2)] = m.group(1)
    return out


def demo_responder(step: str, user: str):
    if step.startswith("requirements"):
        ids = _ids(user)
        reqs = []
        if "FR-3" in ids:
            reqs.append({"id": ids["FR-3"], "criteria": {"unambiguous": "ok", "verifiable": "ok", "boundaries": "issue"},
                         "findings": [{
                             "criterion": "boundaries", "severity": "MEDIUM",
                             "title": "Не определено поведение при превышении лимита",
                             "quote": "Максимальная сумма одного перевода — 500 000 ₸.",
                             "problem": "Не сказано, что происходит при сумме больше лимита и включена ли граница 500 000 ₸.",
                             "risk": "Разная обработка на клиенте и сервере, спорные кейсы в поддержке.",
                             "fix": "Указать включительность границы и ответ системы при превышении.",
                             "rewrite": "Сумма одного перевода — от 1 до 500 000 ₸ включительно; при превышении система "
                                        "отклоняет перевод с сообщением «<уточнить: текст>».", "confidence": 0.9}]})
        if "FR-5" in ids:
            reqs.append({"id": ids["FR-5"], "criteria": {"errors_defined": "issue", "singular": "issue"},
                         "findings": [{
                             "criterion": "errors_defined", "severity": "HIGH",
                             "title": "Не описаны ошибки списания и зачисления",
                             "quote": "деньги списываются со счёта отправителя и зачисляются получателю",
                             "problem": "Нет сценариев: недостаточно средств, неверный SMS-код, сбой зачисления после списания.",
                             "risk": "Деньги могут быть списаны без зачисления — финансовый и репутационный риск.",
                             "fix": "Описать атомарность операции, компенсацию и статусы перевода.",
                             "rewrite": "Списание и зачисление выполняются атомарно; при сбое зачисления списание "
                                        "отменяется не позднее <уточнить: срок>.", "confidence": 0.9}]})
        if "FR-6" in ids:
            reqs.append({"id": ids["FR-6"], "criteria": {"implementation_free": "issue"},
                         "findings": [{
                             "criterion": "implementation_free", "severity": "LOW",
                             "title": "Проектное решение вместо требования",
                             "quote": "Система должна использовать PostgreSQL 16 и Kafka для хранения переводов.",
                             "problem": "Указан стек, а не потребность (сохранность, аудит, срок хранения).",
                             "risk": "Ограничивает архитектуру без обоснования.",
                             "fix": "Сформулировать требование к хранению; выбор технологий — в архитектуре.",
                             "confidence": 0.85}]})
        return {"requirements": reqs}
    if step == "set:consistency":
        ids = _ids(user) or {}
        return {"issues": [{
            "kind": "conflict", "criterion": "set_consistent", "severity": "CRITICAL",
            "title": "Критерий приёмки противоречит лимиту FR-3",
            "req_ids": [ids.get("FR-3", "FR-3")],
            "quotes": ["Максимальная сумма одного перевода — 500 000 ₸.", "Перевести 600 000 ₸"],
            "problem": "FR-3 ограничивает перевод 500 000 ₸, а критерий приёмки ожидает успешный перевод 600 000 ₸.",
            "risk": "Тест и реализация не могут быть выполнены одновременно; приёмка заблокирована.",
            "fix": "Согласовать лимит и исправить либо FR-3, либо критерий приёмки.", "confidence": 0.95}],
            "relations": []}
    if step == "set:completeness":
        return {"issues": [{
            "kind": "gap", "criterion": "set_complete", "severity": "HIGH",
            "title": "Нет требований к идемпотентности перевода",
            "quotes": ["После подтверждения перевода по SMS-коду"],
            "problem": "Не описано, что происходит при повторной отправке подтверждения (двойное нажатие, ретрай сети).",
            "risk": "Двойное списание средств клиента.",
            "fix": "Ввести ключ идемпотентности перевода и правило обработки повторов.", "confidence": 0.85}],
            "relations": []}
    if step == "fintech":
        return {"checks": [
            {"key": "idempotency", "applicable": "yes", "status": "missing", "severity": "HIGH",
             "note": "Повторная отправка подтверждения перевода не описана.",
             "recommendation": "Idempotency-Key в POST /transfers, хранение результата 24 ч."},
            {"key": "rounding", "applicable": "no", "status": "na", "note": "Суммы — целые тенге, округление не требуется."},
        ]}
    if step == "clarify":
        return {"questions": [{
            "req_ids": [], "question": "Какой лимит одного перевода верный: 500 000 ₸ (FR-3) или выше (критерий приёмки)?",
            "why": "Требование и критерий приёмки противоречат друг другу.",
            "risk": "Невозможно принять функцию.", "options": ["500 000 ₸", "1 000 000 ₸", "Другое"]}]}
    if step == "verify":
        return {"verdicts": [{"id": m, "verdict": "keep"} for m in re.findall(r'"id":\s*"(V\d+)"', user)]}
    return {}
