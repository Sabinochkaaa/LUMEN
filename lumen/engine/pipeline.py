"""LÜMEN Core orchestrator — the 15-stage analysis pipeline.

Deterministic components do everything that can be decided by rules; the LLM is used only for
semantics (meaning-level defects, contradictions, gaps, FinTech applicability, clarifications)
and every LLM statement is re-validated against the source document before it reaches the report.
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Callable, Optional

from ..config import Settings, agent_version, settings as default_settings
from ..models import (
    SEVERITY_ORDER,
    Assessment,
    AuditResult,
    Finding,
    FintechCheck,
    Passport,
    Question,
    Relation,
    Requirement,
    StageEvent,
)
from ..parsing.loader import DocumentError, load_document
from ..llm import prompts
from ..llm.client import LLMClient, LLMError, make_chain
from ..llm.schemas import ClarifyResponse, FintechResponse, ReqAuditResponse, SetAuditResponse, VerifyResponse
from .criteria import REQUIREMENT_CRITERIA, criterion_basis, criterion_ref
from .evidence import EvidenceIndex, norm
from .extractor import TYPE_RU, extract
from .fintech import ASPECTS, aspects_for_prompt, is_fintech, offline_checks
from .rules import run_rules
from .scoring import compute

log = logging.getLogger("lumen.pipeline")

STAGES: list[tuple[str, str]] = [
    ("upload", "Загрузка документа"),
    ("validate", "Проверка формата и целостности"),
    ("parse", "Извлечение текста, структуры, страниц и таблиц"),
    ("segment", "Сегментация документа"),
    ("extract", "Выделение и идентификация требований"),
    ("classify", "Классификация требований"),
    ("individual", "Индивидуальная проверка требований"),
    ("consistency", "Межтребовательная проверка (противоречия, дубли)"),
    ("completeness", "Анализ полноты документа"),
    ("fintech", "FinTech-аудит (LÜMEN Risk Engine)"),
    ("clarify", "Уточняющие вопросы (Clarification Engine)"),
    ("verify", "Перепроверка результатов и защита от галлюцинаций"),
    ("stats", "Подсчёт статистики и готовности"),
    ("report", "Генерация отчёта"),
    ("save", "Сохранение отчёта"),
]
ALMATY = timezone(timedelta(hours=5))
ProgressCb = Callable[[StageEvent], None]


class AuditError(Exception):
    """User-facing pipeline failure (message in Russian)."""


class _Tracker:
    def __init__(self, cb: Optional[ProgressCb]):
        self.cb = cb
        self.events: list[StageEvent] = []
        self._t: dict[str, float] = {}

    def _idx(self, key: str) -> int:
        return next(i for i, (k, _) in enumerate(STAGES) if k == key) + 1

    def _emit(self, key: str, status: str, message: str = "") -> None:
        idx = self._idx(key)
        elapsed = int((time.time() - self._t.get(key, time.time())) * 1000)
        ev = StageEvent(index=idx, total=len(STAGES), key=key, title=STAGES[idx - 1][1], status=status,
                        message=message, elapsed_ms=elapsed if status != "running" else 0)
        if status != "running":
            self.events = [e for e in self.events if e.key != key] + [ev]
        if self.cb:
            try:
                self.cb(ev)
            except Exception:  # progress must never break the analysis
                log.debug("progress callback failed", exc_info=True)

    def start(self, key: str, message: str = "") -> None:
        self._t[key] = time.time()
        self._emit(key, "running", message)

    def done(self, key: str, message: str = "") -> None:
        self._emit(key, "done", message)

    def skip(self, key: str, message: str) -> None:
        self._t.setdefault(key, time.time())
        self._emit(key, "skipped", message)

    def error(self, key: str, message: str) -> None:
        self._t.setdefault(key, time.time())
        self._emit(key, "error", message)


# ----------------------------------------------------------------------------- helpers
def _brief(f: Finding) -> dict:
    return {"req": f.req_ids, "criterion": f.criterion, "title": f.title, "quote": f.quote[:120]}


def _req_payload(r: Requirement) -> dict:
    d = {"id": r.id, "source_id": r.source_id if r.source_id_kind == "explicit" else None,
         "section": r.section, "lines": f"{r.loc.line_start}-{r.loc.line_end}", "type": r.type, "text": r.quote}
    if r.context:
        d["context"] = r.context[:3]
    return d


def _chunks(items: list, size: int) -> list[list]:
    return [items[i:i + size] for i in range(0, len(items), max(1, size))]


def _similar(a: str, b: str) -> float:
    x = {w[:5] for w in re.findall(r"[а-яёa-z0-9]{3,}", a.lower())}
    y = {w[:5] for w in re.findall(r"[а-яёa-z0-9]{3,}", b.lower())}
    return len(x & y) / len(x | y) if x and y else 0.0


class _Grounder:
    """Turns raw LLM statements into evidence-backed findings or marks them «требует проверки»."""

    def __init__(self, ev: EvidenceIndex, reqs: list[Requirement], warnings: list[str]):
        self.ev = ev
        self.ids = {r.id: r for r in reqs}
        self.by_source = {r.source_id.lower(): r.id for r in reqs if r.source_id and r.source_id_kind == "explicit"}
        self.warnings = warnings
        self.rejected_ids = 0

    def req_ids(self, raw: list[str]) -> list[str]:
        out = []
        for x in raw or []:
            x = str(x).strip()
            if x in self.ids:
                out.append(x)
            elif x.lower() in self.by_source:
                out.append(self.by_source[x.lower()])
            else:
                self.rejected_ids += 1
        return list(dict.fromkeys(out))

    def ground(self, f: Finding, quotes: list[str], fallback_req: Optional[str] = None) -> Finding:
        matched = []
        for q in quotes:
            if not q or len(norm(q)) < 4:
                continue
            m = self.ev.find(q)
            if m:
                matched.append(m)
        if matched:
            m = matched[0]
            if len(matched) > 1:
                f.quote = "\n".join(dict.fromkeys(f"[строка {x.line_start}] {x.text}" for x in matched))[:1200]
            else:
                f.quote = m.text[:900]
            f.loc = self.ev.location(m.line_start, m.line_end)
            low = min(x.score for x in matched)
            if low < 0.9 or len(matched) < len([q for q in quotes if q]):
                f.confidence = round(min(f.confidence, low), 2)
            for x in matched:  # link every requirement that the evidence touches
                for rid in self.ev.req_for_line(x.line_start):
                    if rid not in f.req_ids:
                        f.req_ids.append(rid)
        else:
            f.status = "needs_review"
            rid = fallback_req or (f.req_ids[0] if f.req_ids else None)
            if rid and rid in self.ids:
                r = self.ids[rid]
                f.loc = r.loc
                f.quote = r.quote[:400]
                f.problem += " [Цитата модели не найдена в документе дословно — показан текст требования.]"
            else:
                f.quote = ""
                f.loc = None
                f.problem += " [Цитата модели не найдена в документе — требуется ручная проверка.]"
        if f.confidence < 0.6:
            f.status = "needs_review"
        return f


def _dedupe(findings: list[Finding]) -> list[Finding]:
    """Remove duplicates: same place + same criterion family + similar wording. Rules win over LLM."""
    families = {
        "unambiguous": "a", "verifiable": "v", "acceptance": "v", "set_validatable": "v",
        "complete": "c", "set_complete": "c", "errors_defined": "c", "inputs_defined": "c", "outputs_defined": "c",
        "boundaries": "c", "consistent": "k", "set_consistent": "k", "terminology": "k",
        "integration_contract": "i", "correct": "k",
    }
    ordered = sorted(findings, key=lambda f: (0 if f.source.startswith("rule") else 1, SEVERITY_ORDER[f.severity]))
    kept: list[Finding] = []
    for f in ordered:
        dup = None
        for k in kept:
            if (f.rule_id.startswith("R-TERM") or k.rule_id.startswith("R-TERM")) and f.rule_id != k.rule_id \
                    and f.source.startswith("rule") and k.source.startswith("rule"):
                continue  # different glossary terms are different defects
            same_place = (f.loc and k.loc and abs(f.loc.line_start - k.loc.line_start) <= 1) or \
                (set(f.req_ids) == set(k.req_ids) and f.req_ids)
            same_family = families.get(f.criterion, f.criterion) == families.get(k.criterion, k.criterion)
            text_sim = _similar(f.title + " " + f.problem, k.title + " " + k.problem)
            if same_place and (same_family and text_sim >= 0.22 or text_sim >= 0.5):
                dup = k
                break
        if dup is None:
            kept.append(f)
        else:
            if SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[dup.severity] and f.status == "confirmed":
                dup.severity = f.severity  # the stronger, evidence-backed assessment wins
            if f.source != dup.source and "+" not in dup.source:
                dup.source = f"{dup.source}+{f.source}".replace("rule+llm", "rule+llm")
                if not dup.rewrite and f.rewrite:
                    dup.rewrite = f.rewrite
    return kept


# ----------------------------------------------------------------------------- pipeline
def run_audit(
    path: str | Path,
    *,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    display_name: Optional[str] = None,
    progress: Optional[ProgressCb] = None,
    cfg: Optional[Settings] = None,
    responder=None,
    demo: bool = False,
    audit_id: Optional[str] = None,
) -> AuditResult:
    cfg = cfg or default_settings
    t0 = time.time()
    tr = _Tracker(progress)
    warnings: list[str] = []

    # 1-3 -------------------------------------------------------------- document
    tr.start("upload", str(display_name or Path(path).name))
    p = Path(path)
    if not p.exists():
        tr.error("upload", "Файл не найден")
        raise AuditError(f"Файл не найден: {p}")
    tr.done("upload", f"{p.stat().st_size:,} байт".replace(",", " "))
    tr.start("validate")
    try:
        doc = load_document(p, display_name)
    except DocumentError as e:
        tr.error("validate", str(e))
        raise AuditError(str(e)) from e
    tr.done("validate", f"Формат: {doc.format.upper()}, SHA-256 {doc.sha256[:12]}…")
    tr.start("parse")
    warnings.extend(doc.warnings)
    tables = len({b.table_id for b in doc.blocks if b.kind == "table_header"})
    tr.done("parse", f"{len(doc.lines)} строк, {doc.pages or '—'} стр., {tables} таблиц")

    # 4-6 -------------------------------------------------------------- requirements
    tr.start("segment")
    sections = len([b for b in doc.blocks if b.kind == "heading"])
    tr.done("segment", f"{len(doc.blocks)} блоков, {sections} разделов")
    tr.start("extract")
    ex = extract(doc)
    reqs = ex.requirements
    if not reqs:
        tr.error("extract", "Требования не найдены")
        raise AuditError("В документе не удалось выделить ни одного требования — проверьте, что это документ требований.")
    explicit = sum(1 for r in reqs if r.source_id_kind == "explicit")
    tr.done("extract", f"{len(reqs)} требований, с исходным ID: {explicit}")
    tr.start("classify")
    ev = EvidenceIndex(doc, reqs)
    types = {}
    for r in reqs:
        types[r.type] = types.get(r.type, 0) + 1
    tr.done("classify", ", ".join(f"{TYPE_RU.get(k, k)}: {v}" for k, v in sorted(types.items(), key=lambda x: -x[1])))

    # LLM client
    prov = cfg.resolve_provider(provider)
    mdl = cfg.resolve_model(prov, model)
    client: Optional[LLMClient] = make_chain(prov, mdl, cfg, responder)
    mode = "offline" if client is None else ("mock" if prov == "mock" else "llm")
    if client is None:
        warnings.append("Семантическая проверка моделью не выполнялась (офлайн-режим): отчёт построен только "
                        "детерминированными правилами LÜMEN Core. Для полного анализа задайте ключ LLM в .env.")

    # 7-8 deterministic part
    tr.start("individual", "Детерминированные правила")
    ctx = run_rules(doc, ex, ev)
    rule_findings = list(ctx.findings)
    grounder = _Grounder(ev, reqs, warnings)
    doc_text = doc.numbered_text()
    from ..knowledge.glossary import knowledge_block

    kb = knowledge_block("\n".join(l.text for l in doc.lines))
    system = prompts.SYSTEM + ("\n\n" + kb if kb else "")
    rule_brief = [_brief(f) for f in rule_findings]
    llm_findings: list[Finding] = []
    llm_relations: list[Relation] = []
    llm_criteria: dict[str, dict[str, str]] = {}
    llm_types: dict[str, tuple[str, str]] = {}
    fin_llm: Optional[FintechResponse] = None
    llm_ok = client is not None
    step_errors: list[str] = []

    def do_batch(batch: list[Requirement]):
        payload = [_req_payload(r) for r in batch]
        related = [b for b in rule_brief if set(b["req"]) & {r.id for r in batch} or not b["req"]]
        return client.structured(system, prompts.requirements_prompt(doc_text, payload, related),
                                 ReqAuditResponse, f"requirements {batch[0].id}–{batch[-1].id}")

    def do_set(focus: str):
        payload = [{"id": r.id, "source_id": r.source_id, "type": r.type, "section": r.section,
                    "summary": r.summary} for r in reqs]
        return client.structured(system, prompts.set_prompt(doc_text, payload, rule_brief, focus),
                                 SetAuditResponse, f"set:{focus}")

    def do_fin():
        payload = [{"id": r.id, "summary": r.summary} for r in reqs]
        return client.structured(system, prompts.fintech_prompt(doc_text, payload, aspects_for_prompt()),
                                 FintechResponse, "fintech")

    if client is not None:
        batches = _chunks(reqs, cfg.batch_size)
        tr.start("individual", f"LLM {prov}/{mdl}: {len(batches)} пакет(ов) по ≤{cfg.batch_size} требований")
        tr.start("consistency", "Правила + LLM (параллельно)")
        tr.start("completeness", "LLM (параллельно)")
        tr.start("fintech", "Правила применимости + LLM (параллельно)")
        retried = {"ok": 0}

        def settle(fut, fn, *args):
            """Result of a parallel LLM step; on failure, retry once sequentially (after a pause) on whatever
            provider/model is working now. Free tiers often reject bursts of parallel calls."""
            try:
                return fut.result()
            except LLMError as first:
                log.warning("LLM step failed (%s) — retrying sequentially", str(first)[:160])
                time.sleep(cfg.retry_pause)
                try:
                    out = fn(*args)
                    retried["ok"] += 1
                    return out
                except LLMError as e:
                    step_errors.append(str(e))
                    raise

        with ThreadPoolExecutor(max_workers=max(1, cfg.concurrency)) as pool:
            f_batches = [pool.submit(do_batch, b) for b in batches]
            f_cons = pool.submit(do_set, "consistency")
            f_comp = pool.submit(do_set, "completeness")
            f_fin = pool.submit(do_fin)
            # individual
            ok_batches = 0
            for fut, batch in zip(f_batches, batches):
                try:
                    resp: ReqAuditResponse = settle(fut, do_batch, batch)
                    ok_batches += 1
                except LLMError:
                    continue
                allowed = {r.id for r in batch}
                for item in resp.requirements:
                    rid = item.id if item.id in allowed else (grounder.req_ids([item.id]) or [None])[0]
                    if rid not in allowed:
                        grounder.rejected_ids += 1
                        continue
                    llm_criteria[rid] = {k: v for k, v in item.criteria.items() if k in REQUIREMENT_CRITERIA}
                    if item.type or item.summary:
                        llm_types[rid] = (item.type, item.summary)
                    for lf in item.findings:
                        crit = lf.criterion if lf.criterion in REQUIREMENT_CRITERIA else "complete"
                        f = Finding(scope="requirement", req_ids=[rid], criterion=crit, severity=lf.severity,
                                    title=lf.title, quote=lf.quote, problem=lf.problem, risk=lf.risk, fix=lf.fix,
                                    rewrite=lf.rewrite, source="llm", rule_id="LLM-req",
                                    basis=criterion_basis(crit), standard_ref=criterion_ref(crit),
                                    confidence=lf.confidence)
                        llm_findings.append(grounder.ground(f, [lf.quote], rid))
            if ok_batches == 0:
                llm_ok = False
            tr.done("individual", f"Правила: {len(rule_findings)} замечаний; LLM: пакетов {ok_batches}/{len(batches)}")
            # set-level
            for key, fut in (("consistency", f_cons), ("completeness", f_comp)):
                try:
                    resp: SetAuditResponse = settle(fut, do_set, key)
                except LLMError as e:
                    tr.error(key, str(e)[:200])
                    continue
                n = 0
                for it in resp.issues:
                    crit = it.criterion if it.criterion in prompts.SET_CRITERIA else (
                        "set_consistent" if it.kind in ("conflict", "duplicate", "numeric") else
                        "terminology" if it.kind == "terminology" else
                        "integration_contract" if it.kind == "integration" else "set_complete")
                    ids = grounder.req_ids(it.req_ids)
                    f = Finding(scope="set", req_ids=ids, criterion=crit, severity=it.severity,
                                title=it.title, problem=it.problem, risk=it.risk, fix=it.fix, rewrite=it.rewrite,
                                source="llm", rule_id=f"LLM-{it.kind}", basis=criterion_basis(crit),
                                standard_ref=criterion_ref(crit), confidence=it.confidence)
                    llm_findings.append(grounder.ground(f, it.quotes, ids[0] if ids else None))
                    n += 1
                for rel in resp.relations:
                    s_ids, t_ids = grounder.req_ids([rel.source]), grounder.req_ids([rel.target])
                    if s_ids and t_ids and s_ids[0] != t_ids[0]:
                        llm_relations.append(Relation(source=s_ids[0], target=t_ids[0], type=rel.type,
                                                      status="confirmed" if rel.confident else "needs_confirmation",
                                                      note=rel.note[:200], origin="llm"))
                tr.done(key, f"LLM: {n} замечаний, {len(resp.relations)} связей")
            try:
                fin_llm = settle(f_fin, do_fin)
            except LLMError:
                pass
        if retried["ok"]:
            warnings.append(f"{retried['ok']} шаг(ов) LLM не прошли с первого раза (лимиты бесплатного тарифа) и "
                            "были успешно выполнены повторно — результат полный.")
    else:
        tr.done("individual", f"Правила: {len(rule_findings)} замечаний")
        tr.done("consistency", f"Правила: {sum(1 for f in rule_findings if f.scope == 'set')} замечаний набора, "
                               f"{len(ctx.relations)} связей")
        tr.skip("completeness", "Требуется LLM — смысловая полнота не оценивалась")

    # 10 FinTech -------------------------------------------------------------
    fin_checks = offline_checks("\n".join(l.text for l in doc.lines), reqs)
    if fin_llm is not None:
        names = {k: n for k, n, _ in ASPECTS}
        by_key = {c.key: c for c in fin_checks}
        for c in fin_llm.checks:
            if c.key not in names:
                continue
            fc = FintechCheck(key=c.key, aspect=names[c.key], applicable=c.applicable, status=c.status,
                              note=c.note, req_ids=grounder.req_ids(c.req_ids), severity=c.severity,
                              recommendation=c.recommendation, source="llm")
            if c.quote:
                m = ev.find(c.quote)
                fc.quote = m.text if m else ""
            if fc.applicable == "no":
                fc.status, fc.severity = "na", "INFO"
            by_key[c.key] = fc
        fin_checks = [by_key[k] for k, _, _ in ASPECTS]
        for fc in fin_checks:  # material FinTech gaps become findings (expert basis, never normative)
            if fc.source == "llm" and fc.applicable == "yes" and fc.status in ("missing", "partial") \
                    and fc.severity in ("CRITICAL", "HIGH", "MEDIUM"):
                f = Finding(scope="set", req_ids=fc.req_ids, criterion="fintech", severity=fc.severity,
                            title=f"FinTech: {fc.aspect} — {'не описано' if fc.status == 'missing' else 'описано неполно'}",
                            problem=fc.note, risk="Отраслевой риск платёжной системы.", fix=fc.recommendation,
                            source="llm", rule_id=f"FIN-{fc.key}", basis="expert", standard_ref="LÜMEN Risk Engine",
                            confidence=0.75)
                llm_findings.append(grounder.ground(f, [fc.quote] if fc.quote else [], fc.req_ids[0] if fc.req_ids else None)
                                    if fc.quote else f)
        tr.done("fintech", f"Применимо: {sum(1 for c in fin_checks if c.applicable == 'yes')}, "
                           f"пробелов: {sum(1 for c in fin_checks if c.status == 'missing')}")
    else:
        msg = "Документ относится к финансовой предметной области" if is_fintech("\n".join(l.text for l in doc.lines)) \
            else "Финансовая предметная область не обнаружена — проверки N/A"
        tr.done("fintech", msg + ("" if client else " (без LLM — только упоминания)"))
    if client is not None and fin_llm is None:
        tr.error("fintech", "LLM-шаг не выполнен — использованы только правила применимости")

    # merge + dedupe ---------------------------------------------------------
    findings = _dedupe(rule_findings + llm_findings)

    # 11 Clarification ---------------------------------------------------------
    tr.start("clarify")
    questions: list[Question] = list(ctx.questions)
    if client is not None and llm_ok:
        try:
            top = sorted(findings, key=lambda f: SEVERITY_ORDER[f.severity])[:40]
            resp: ClarifyResponse = client.structured(
                prompts.SYSTEM,
                prompts.clarify_prompt(doc_text, [{"req": f.req_ids, "severity": f.severity, "title": f.title,
                                                   "problem": f.problem[:300]} for f in top],
                                       [q.question for q in questions]),
                ClarifyResponse, "clarify")
            for q in resp.questions:
                questions.append(Question(req_ids=grounder.req_ids(q.req_ids), question=q.question, why=q.why,
                                          risk=q.risk, options=q.options[:5], source="llm"))
        except LLMError as e:
            step_errors.append(str(e))
    # dedupe questions, link to findings
    uniq: list[Question] = []
    for q in questions:
        if any(_similar(q.question, u.question) >= 0.6 for u in uniq):
            continue
        uniq.append(q)
    questions = uniq
    tr.done("clarify", f"{len(questions)} вопросов к владельцу требований")

    # 12 Verification ---------------------------------------------------------
    tr.start("verify")
    rejected = 0
    if client is not None and llm_ok and cfg.verify:
        to_check = [f for f in findings if f.source == "llm" and f.severity in ("CRITICAL", "HIGH")
                    and f.status == "confirmed"]
        if to_check:
            for i, f in enumerate(to_check):
                f.id = f"V{i + 1}"
            try:
                vr: VerifyResponse = client.structured(
                    prompts.SYSTEM,
                    prompts.verify_prompt(doc_text, [{"id": f.id, "severity": f.severity, "title": f.title,
                                                      "quote": f.quote[:400], "problem": f.problem[:500],
                                                      "req": f.req_ids} for f in to_check]),
                    VerifyResponse, "verify")
                verdicts = {v.id: v for v in vr.verdicts}
                for f in to_check:
                    v = verdicts.get(f.id)
                    if not v:
                        continue
                    if v.verdict == "reject":
                        f.status = "needs_review"
                        f.problem += f" [Независимая перепроверка не подтвердила дефект: {v.reason[:200]}]"
                        rejected += 1
                    elif v.verdict == "downgrade" and v.severity and SEVERITY_ORDER[v.severity] > SEVERITY_ORDER[f.severity]:
                        f.problem += f" [Критичность снижена перепроверкой с {f.severity}: {v.reason[:160]}]"
                        f.severity = v.severity
            except LLMError as e:
                step_errors.append(str(e))
    for f in findings:
        f.id = ""
    findings.sort(key=lambda f: (SEVERITY_ORDER[f.severity], f.status != "confirmed",
                                 f.loc.line_start if f.loc else 10 ** 6))
    for i, f in enumerate(findings, start=1):
        f.id = f"F-{i:03d}"
    for i, q in enumerate(questions, start=1):
        q.id = f"Q-{i:03d}"
        q.finding_ids = [f.id for f in findings if set(f.req_ids) & set(q.req_ids)][:6]
    # relations: rules + llm + conflicts implied by findings; validate ids; drop dups
    relations = list(ctx.relations) + llm_relations
    for f in findings:
        if f.criterion in ("consistent", "set_consistent") and len(f.req_ids) >= 2 and f.rule_id.startswith(("LLM-conflict", "API-", "LLM-numeric")):
            relations.append(Relation(source=f.req_ids[0], target=f.req_ids[1], type="conflicts_with",
                                      status="confirmed" if f.status == "confirmed" else "needs_confirmation",
                                      note=f"{f.id}: {f.title}"[:200], origin="finding"))
    seen, rel_ok = set(), []
    ids = {r.id for r in reqs}
    for r in relations:
        key = (r.source, r.target, r.type)
        if r.source in ids and r.target in ids and key not in seen:
            seen.add(key)
            rel_ok.append(r)
    needs = sum(1 for f in findings if f.status == "needs_review")
    tr.done("verify", f"Цитаты сверены с документом; «требует проверки»: {needs}; отклонено перепроверкой: {rejected}; "
                      f"отброшено несуществующих ID: {grounder.rejected_ids}")

    # assessments
    assessments: list[Assessment] = []
    for r in reqs:
        crit: dict[str, str] = {k: "unknown" for k in REQUIREMENT_CRITERIA}
        crit["traceable"] = "ok" if r.source_id_kind == "explicit" else "issue"
        crit.update(llm_criteria.get(r.id, {}))
        for f in findings:
            if r.id in f.req_ids and f.criterion in REQUIREMENT_CRITERIA and f.status == "confirmed":
                crit[f.criterion] = "issue"
        if r.id in llm_types:
            t, s = llm_types[r.id]
            if t in TYPE_RU and r.type in ("other", ""):
                r.type = t
            if s and r.source_id_kind != "explicit" and len(r.summary) > 90:
                r.summary = s
        assessments.append(Assessment(req_id=r.id, criteria=crit))  # type: ignore[arg-type]

    # 13 stats -------------------------------------------------------------
    tr.start("stats")
    if step_errors:
        uniq_err = list(dict.fromkeys(e[:240] for e in step_errors))
        warnings.append(f"Часть шагов LLM завершилась ошибкой ({len(step_errors)}): " + " | ".join(uniq_err[:3]))
    scores, readiness, reason = compute(reqs, assessments, findings, questions, llm_ok)
    priorities = []
    for f in findings:
        if f.status == "confirmed" and f.severity in ("CRITICAL", "HIGH") and len(priorities) < 8:
            where = f.loc.label() if f.loc else "документ в целом"
            priorities.append(f"[{f.severity}] {f.title} ({', '.join(f.req_ids) or 'набор'}; {where}) — {f.fix or f.problem}")
    if not priorities:
        priorities = [f"[{f.severity}] {f.title} — {f.fix}" for f in findings if f.status == "confirmed"][:5]
    tr.done("stats", f"Индекс качества {scores.quality_index}, готовность: {readiness}")

    ver = agent_version()
    usage = client.usage if client else None
    if client is not None and (client.provider != prov or client.model != mdl):
        warnings.append(f"Основная модель {prov}/{mdl} была недоступна; анализ выполнен резервной моделью "
                        f"{client.provider}/{client.model}.")
        prov, mdl = client.provider, client.model
    passport = Passport(
        document_name=doc.name, document_title=doc.title, document_format=doc.format, document_sha256=doc.sha256,
        analysed_at=datetime.now(ALMATY).isoformat(timespec="seconds"), provider=prov, model=mdl,
        agent_version=ver["version"], agent_commit=ver["commit"], mode=mode,  # type: ignore[arg-type]
        duration_s=round(time.time() - t0, 1), llm_calls=usage.calls if usage else 0,
        llm_failures=usage.failures if usage else 0, tokens_in=usage.tokens_in if usage else 0,
        tokens_out=usage.tokens_out if usage else 0,
    )
    return AuditResult(
        id=audit_id or uuid.uuid4().hex[:12], passport=passport, requirements=reqs, assessments=assessments,
        findings=findings, relations=rel_ok, questions=questions, fintech=fin_checks, scores=scores,
        readiness=readiness, readiness_reason=reason, priorities=priorities, stages=tr.events, warnings=warnings,
        demo=demo, source=doc.lines,
    )


def finalize(result: AuditResult, output: str | Path, progress: Optional[ProgressCb] = None,
             formats: tuple[str, ...] = ("md", "html", "json")) -> dict[str, Path]:
    """Stages 14–15: render the report and write it next to the requested output path."""
    from ..report.render import render_html, render_markdown

    tr = _Tracker(progress)
    tr.events = list(result.stages)
    out = Path(output)
    tr.start("report")
    base = out.with_suffix("") if out.suffix.lower() in (".md", ".html", ".json", ".pdf", ".docx", ".xlsx") else out
    paths: dict[str, Path] = {}
    md = render_markdown(result)
    html = render_html(result)
    tr.done("report", f"Markdown {len(md) // 1024} КБ, HTML {len(html) // 1024} КБ")
    tr.start("save")
    try:
        base.parent.mkdir(parents=True, exist_ok=True)
        main_fmt = out.suffix.lower().lstrip(".") or "md"
        targets = {k: base.with_suffix("." + k) for k in ("md", "html", "json", "pdf", "docx", "xlsx")}
        if main_fmt in targets:
            targets[main_fmt] = out
        for fmt in formats:
            pth = targets[fmt]
            if fmt == "md":
                pth.write_text(md, encoding="utf-8")
            elif fmt == "html":
                pth.write_text(html, encoding="utf-8")
            elif fmt == "json":
                pth.write_text(result.model_dump_json(indent=1), encoding="utf-8")
            else:
                from ..report.export import render as export_render

                pth.write_bytes(export_render(result, fmt))
            paths[fmt] = pth
    except OSError as e:
        tr.error("save", str(e))
        raise AuditError(f"Не удалось записать отчёт: {e}") from e
    tr.done("save", ", ".join(str(p) for p in paths.values()))
    result.stages = tr.events
    if "json" in paths:  # persist final stage list
        paths["json"].write_text(result.model_dump_json(indent=1), encoding="utf-8")
    return paths
