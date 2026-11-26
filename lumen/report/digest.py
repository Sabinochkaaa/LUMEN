"""Executive digest shared by every report format: what to fix first, what to ask, where it hurts.

A reader decides in the first screen whether the document is ready; the full evidence stays below.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models import SEVERITY_ORDER, AuditResult, Finding, Question

VERDICT = {
    "READY": ("ГОТОВ", "Можно начинать разработку и тестирование."),
    "READY WITH CONDITIONS": ("ГОТОВ С УСЛОВИЯМИ", "Начинать после исправлений и ответов владельца."),
    "NOT READY": ("НЕ ГОТОВ", "Начинать разработку и тестирование рано."),
    "INSUFFICIENT DATA": ("МАЛО ДАННЫХ", "Оценка ненадёжна: смысловая проверка моделью не выполнена."),
}
VERDICT_HEX = {"READY": "12B76A", "READY WITH CONDITIONS": "DC9A06", "NOT READY": "D92D20", "INSUFFICIENT DATA": "667085"}
SEV_SHORT = {"CRITICAL": "Критично", "HIGH": "Высокая", "MEDIUM": "Средняя", "LOW": "Низкая", "INFO": "Инфо"}


def short(text: str, limit: int = 180) -> str:
    """First sentence(s) that fit the limit; never cut a word in half."""
    t = re.sub(r"\s+", " ", text or "").strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    dot = max(cut.rfind(". "), cut.rfind("; "))
    if dot > limit * 0.5:
        return cut[: dot + 1]
    return cut[: cut.rfind(" ")].rstrip(",;:—-") + "…"


def where(f: Finding) -> str:
    if not f.loc:
        return "весь документ"
    s = f"строка {f.loc.line_start}" if f.loc.line_start == f.loc.line_end else f"строки {f.loc.line_start}–{f.loc.line_end}"
    return (f"стр. {f.loc.page}, " if f.loc.page else "") + s


@dataclass
class Digest:
    fixes: list[Finding] = field(default_factory=list)          # top issues, one per distinct problem
    questions: list[Question] = field(default_factory=list)     # open questions behind the worst issues
    heat: list[tuple[str, str, float]] = field(default_factory=list)  # (req id, worst severity or "", score)
    fintech_gaps: list[tuple[str, str, str]] = field(default_factory=list)  # (aspect, status, recommendation)
    clean: int = 0


def build(r: AuditResult, top: int = 5) -> Digest:
    conf = sorted((f for f in r.findings if f.status == "confirmed"),
                  key=lambda f: (SEVERITY_ORDER[f.severity], -f.confidence))
    d = Digest()
    seen: set[str] = set()
    for f in conf:
        k = re.sub(r"\W+", " ", f.title.lower()).strip()
        if k in seen or f.severity in ("LOW", "INFO"):
            continue
        seen.add(k)
        d.fixes.append(f)
        if len(d.fixes) == top:
            break
    sev_of = {f.id: SEVERITY_ORDER[f.severity] for f in r.findings}
    open_q = [q for q in r.questions if q.status == "open"]
    d.questions = sorted(open_q, key=lambda q: min((sev_of.get(i, 9) for i in q.finding_ids), default=9))[:top]
    worst: dict[str, str] = {}
    for f in conf:
        for rid in f.req_ids:
            if rid not in worst or SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[worst[rid]]:
                worst[rid] = f.severity
    amap = {a.req_id: a.score for a in r.assessments}
    d.heat = [(x.id, worst.get(x.id, ""), amap.get(x.id, 100.0)) for x in r.requirements]
    d.clean = sum(1 for _, s, _ in d.heat if not s)
    gaps = [(c.aspect, c.status, c.recommendation or c.note) for c in r.fintech
            if c.applicable != "no" and c.status in ("missing", "partial")]
    # placeholder notes ("будет оценено моделью") are not advice — keep only gaps with something to do
    gaps = [g for g in gaps if g[2] and "семантическ" not in g[2].lower()]
    d.fintech_gaps = sorted(gaps, key=lambda g: g[1] != "missing")[:8]
    return d
