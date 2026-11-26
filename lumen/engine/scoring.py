"""Scoring Engine — transparent, reproducible formulas (not an official ISO grade)."""
from __future__ import annotations

from statistics import mean

from ..models import Assessment, Finding, Question, Requirement, Scores, SEVERITY_ORDER
from .criteria import REQUIREMENT_CRITERIA

PENALTY = {"CRITICAL": 40, "HIGH": 20, "MEDIUM": 8, "LOW": 3, "INFO": 0}
METHOD = (
    "Штраф дефекта: CRITICAL 40, HIGH 20, MEDIUM 8, LOW 3, INFO 0; замечания «требует проверки» — ×0.5. "
    "Балл требования = max(0, 100 − Σ штрафов его дефектов − ½ Σ штрафов межтребовательных дефектов с его участием). "
    "Индекс требований = среднее баллов. Индекс набора = 100 / (1 + P/50), P — Σ штрафов дефектов уровня набора "
    "(индекс вдвое ниже при P = 50). Общий индекс качества = 0.6 × индекс требований + 0.4 × индекс набора. "
    "Покрытие критериев = доля пар «требование × критерий», получивших вердикт ok/issue/na. "
    "Готовность: NOT READY — есть CRITICAL или ≥ 5 HIGH; READY WITH CONDITIONS — есть HIGH/MEDIUM; "
    "READY — только LOW/INFO; INSUFFICIENT DATA — < 3 требований, покрытие критериев < 50% "
    "или семантическая проверка (LLM) не выполнялась при отсутствии CRITICAL."
)


def plural(n: int, one: str, few: str, many: str) -> str:
    n10, n100 = n % 10, n % 100
    form = one if n10 == 1 and n100 != 11 else few if 2 <= n10 <= 4 and not 12 <= n100 <= 14 else many
    return f"{n} {form}"


def _w(f: Finding) -> float:
    return PENALTY[f.severity] * (0.5 if f.status == "needs_review" else 1.0)


def compute(reqs: list[Requirement], assessments: list[Assessment], findings: list[Finding],
            questions: list[Question], llm_ok: bool) -> tuple[Scores, str, str]:
    by_req: dict[str, float] = {r.id: 0.0 for r in reqs}
    set_pen = 0.0
    for f in findings:
        if f.scope == "requirement" and f.req_ids:
            for rid in f.req_ids:
                if rid in by_req:
                    by_req[rid] += _w(f) / (1 if len(f.req_ids) == 1 else 2)
        else:
            set_pen += _w(f)
            for rid in f.req_ids:
                if rid in by_req:
                    by_req[rid] += _w(f) / 2
    amap = {a.req_id: a for a in assessments}
    for r in reqs:
        a = amap[r.id]
        a.score = round(max(0.0, 100.0 - by_req[r.id]), 1)
        sev = [f.severity for f in findings if r.id in f.req_ids and f.status == "confirmed"]
        a.verdict = "fail" if any(s in ("CRITICAL", "HIGH") for s in sev) else ("warn" if "MEDIUM" in sev else "pass")
    req_index = round(mean(a.score for a in assessments), 1) if assessments else 0.0
    set_index = round(100.0 / (1.0 + set_pen / 50.0), 1)
    quality = round(0.6 * req_index + 0.4 * set_index, 1)

    total_pairs = len(reqs) * len(REQUIREMENT_CRITERIA)
    judged = sum(1 for a in assessments for k in REQUIREMENT_CRITERIA if a.criteria.get(k) in ("ok", "issue", "na"))
    coverage = round(judged / total_pairs, 3) if total_pairs else 0.0

    conf = [f for f in findings if f.status == "confirmed"]
    by_sev = {s: sum(1 for f in conf if f.severity == s) for s in SEVERITY_ORDER}
    scores = Scores(
        quality_index=quality, requirements_index=req_index, set_index=set_index,
        checked_requirements=sum(1 for a in assessments if a.criteria), total_requirements=len(reqs),
        findings_total=len(conf), by_severity=by_sev,
        contradictions=sum(1 for f in conf if f.criterion in ("consistent", "set_consistent") and len(f.req_ids) >= 2
                           or f.rule_id.startswith("LLM-conflict")),
        incomplete=sum(1 for f in conf if f.criterion in ("complete", "set_complete")),
        unverifiable=sum(1 for f in conf if f.criterion in ("verifiable", "acceptance", "set_validatable")),
        ambiguous=sum(1 for f in conf if f.criterion == "unambiguous"),
        open_questions=sum(1 for q in questions if q.status == "open"),
        needs_review=sum(1 for f in findings if f.status == "needs_review"),
        criteria_coverage=coverage, method=METHOD,
    )
    crit, high, med = by_sev["CRITICAL"], by_sev["HIGH"], by_sev["MEDIUM"]
    if len(reqs) < 3:
        return scores, "INSUFFICIENT DATA", f"Выделено всего {len(reqs)} требований — недостаточно для оценки набора."
    if crit or high >= 5:
        why = []
        if crit:
            why.append(plural(crit, "критический дефект", "критических дефекта", "критических дефектов"))
        if high:
            why.append(plural(high, "дефект высокой критичности", "дефекта высокой критичности",
                              "дефектов высокой критичности"))
        return scores, "NOT READY", "Обнаружено " + " и ".join(why) + " — разработку и тестирование начинать рано."
    if not llm_ok:
        return scores, "INSUFFICIENT DATA", (
            "Семантическая проверка моделью не выполнялась (офлайн-режим): правила нашли "
            f"{plural(len(conf), 'дефект', 'дефекта', 'дефектов')}, но противоречия и полнота смысла не оценены. Запустите с LLM-ключом.")
    if coverage < 0.5:
        return scores, "INSUFFICIENT DATA", f"Покрытие критериев {coverage:.0%} — оценка ненадёжна."
    if high or med:
        return scores, "READY WITH CONDITIONS", f"Критических дефектов нет; требуется устранить {high} HIGH и {med} MEDIUM."
    return scores, "READY", "Серьёзных блокирующих проблем не обнаружено."
