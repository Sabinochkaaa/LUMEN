"""LÜMEN Compare — сравнение двух прогонов (например, версии документа до и после исправлений)."""
from __future__ import annotations

import re

from .models import AuditResult, Finding


def _key(f: Finding) -> str:
    title = re.sub(r"REQ-\d+|F-\d+|\d+", "#", f.title.lower())
    return f"{f.criterion}|{f.rule_id if not f.rule_id.startswith('LLM') else ''}|{title}"


def _sim(a: str, b: str) -> float:
    x = {w[:5] for w in re.findall(r"[а-яёa-z]{4,}", a.lower())}
    y = {w[:5] for w in re.findall(r"[а-яёa-z]{4,}", b.lower())}
    return len(x & y) / len(x | y) if x and y else 0.0


def compare(base: AuditResult, new: AuditResult) -> dict:
    old = [f for f in base.findings if f.status == "confirmed"]
    cur = [f for f in new.findings if f.status == "confirmed"]
    matched_new: set[int] = set()
    remaining, fixed = [], []
    for f in old:
        hit = None
        for j, g in enumerate(cur):
            if j in matched_new:
                continue
            if _key(f) == _key(g) or (f.criterion == g.criterion and _sim(f.title + " " + f.problem, g.title + " " + g.problem) >= 0.5):
                hit = j
                break
        if hit is None:
            fixed.append(f)
        else:
            matched_new.add(hit)
            remaining.append((f, cur[hit]))
    added = [g for j, g in enumerate(cur) if j not in matched_new]

    def brief(f: Finding) -> dict:
        return {"id": f.id, "severity": f.severity, "title": f.title, "criterion": f.criterion,
                "where": f.loc.label() if f.loc else ""}

    return {
        "base": {"id": base.id, "document": base.passport.document_name, "analysed_at": base.passport.analysed_at,
                 "quality_index": base.scores.quality_index, "readiness": base.readiness,
                 "findings": base.scores.findings_total, "requirements": base.scores.total_requirements},
        "new": {"id": new.id, "document": new.passport.document_name, "analysed_at": new.passport.analysed_at,
                "quality_index": new.scores.quality_index, "readiness": new.readiness,
                "findings": new.scores.findings_total, "requirements": new.scores.total_requirements},
        "delta_quality": round(new.scores.quality_index - base.scores.quality_index, 1),
        "fixed": [brief(f) for f in fixed],
        "added": [brief(f) for f in added],
        "remaining": [brief(g) for _, g in remaining],
        "critical_fixed": sum(1 for f in fixed if f.severity in ("CRITICAL", "HIGH")),
        "critical_added": sum(1 for f in added if f.severity in ("CRITICAL", "HIGH")),
    }
