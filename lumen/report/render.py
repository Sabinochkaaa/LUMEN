"""Report Generator — Russian report (Markdown + standalone HTML) in the structure required by the organizers.

Every finding is rendered with: what, where (line/page/section), verbatim quote, why it is a problem,
risk, how to fix and an improved wording (if possible).
"""
from __future__ import annotations

import html as _html
import re
from collections import Counter
from datetime import datetime

from .. import PRODUCT_NAME, __version__
from ..config import PROVIDER_LABELS
from ..engine.criteria import REQUIREMENT_CRITERIA, SET_CRITERIA, criterion_name
from ..engine.extractor import TYPE_RU
from ..engine.scoring import METHOD
from ..models import SEVERITY_ORDER, AuditResult, Finding

SEV_ICON = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}
ST_ICON = {"ok": "✅", "issue": "❌", "na": "N/A", "unknown": "·"}
READY_RU = {
    "READY": "✅ READY — можно начинать разработку и тестирование",
    "READY WITH CONDITIONS": "🟡 READY WITH CONDITIONS — можно начинать после исправлений и согласований",
    "NOT READY": "❌ NOT READY — начинать разработку и тестирование нельзя",
    "INSUFFICIENT DATA": "⚪ INSUFFICIENT DATA — недостаточно данных для надёжной оценки",
}
MODE_RU = {"llm": "LLM + детерминированные правила", "offline": "Только детерминированные правила (без LLM)",
           "mock": "Mock LLM (демонстрация/тест — не для сдачи)"}
FIN_ST = {"covered": "✅ описано", "partial": "🟡 частично", "missing": "❌ не описано", "na": "N/A",
          "unknown": "· не оценено"}
CRIT_ABBR = {
    "unambiguous": "Одн", "complete": "Пол", "verifiable": "Пров", "consistent": "Согл", "necessary": "Необх",
    "singular": "Атом", "feasible": "Реал", "traceable": "Трас", "correct": "Корр", "implementation_free": "БезПР",
    "inputs_defined": "Вход", "outputs_defined": "Выход", "errors_defined": "Ошиб", "acceptance": "Приём",
    "boundaries": "Гран",
}


def _c(text: str) -> str:
    """Escape a value for a Markdown table cell."""
    return re.sub(r"\s+", " ", str(text or "")).replace("|", "\\|").strip()


def _q(text: str, limit: int = 600) -> str:
    t = "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in (text or "").split("\n") if ln.strip())
    return t if len(t) <= limit else t[: limit - 1] + "…"


def _dt(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%d.%m.%Y %H:%M:%S (UTC%z)").replace("UTC+0500", "UTC+05:00")
    except Exception:
        return iso


def _where(f: Finding) -> str:
    return f.loc.label() if f.loc else "документ в целом (конкретного места нет — пробел)"


def set_criteria_status(r: AuditResult) -> dict[str, str]:
    conf = [f for f in r.findings if f.status == "confirmed"]
    out = {}
    for k in SET_CRITERIA:
        hit = [f for f in conf if f.criterion == k]
        if hit:
            out[k] = "issue"
        elif r.passport.mode == "offline" and k in ("set_complete", "set_comprehensible", "set_feasible", "terminology"):
            out[k] = "unknown"
        else:
            out[k] = "ok"
    return out


# =========================================================================== Markdown
def _finding_md(f: Finding, n_level: str = "####") -> list[str]:
    status = "" if f.status == "confirmed" else " · ⚠️ требует проверки"
    src = {"rule": "правило", "llm": "LLM", "rule+llm": "правило + LLM"}.get(f.source, f.source)
    out = [f"{n_level} {SEV_ICON[f.severity]} {f.id} · {f.severity} · {_c(f.title)}{status}", ""]
    out.append(f"* **Критерий:** {criterion_name(f.criterion)} ({f.standard_ref or '—'}; "
               f"{'нормативное' if f.basis == 'normative' else 'экспертная рекомендация'}); источник: {src}"
               f"{f' ({f.rule_id})' if f.rule_id and not f.rule_id.startswith('LLM') else ''}"
               f"{'' if f.confidence >= 0.95 else f'; уверенность {f.confidence:.0%}'}")
    out.append(f"* **Где:** {_where(f)}" + (f"; требования: {', '.join(f.req_ids)}" if f.req_ids else ""))
    if f.quote:
        q = "\n  >\n".join("  > " + ln for ln in _q(f.quote, 900).split("\n"))
        out.append("* **Цитата:**\n\n" + q + "\n")
    out.append(f"* **Что не так:** {f.problem}")
    if f.risk:
        out.append(f"* **Риск:** {f.risk}")
    if f.fix:
        out.append(f"* **Как исправить:** {f.fix}")
    if f.rewrite:
        out.append(f"* **Улучшенная формулировка:** _{_q(f.rewrite, 700)}_")
    out.append("")
    return out


def render_markdown(r: AuditResult) -> str:
    p, s = r.passport, r.scores
    conf = [f for f in r.findings if f.status == "confirmed"]
    L: list[str] = []
    a = L.append

    a(f"# Отчёт о проверке требований: «{p.document_title or p.document_name}»")
    a("")
    if r.demo:
        a("> ⚠️ **ДЕМОНСТРАЦИОННЫЙ ПРОГОН.** Документ и ответы модели подготовлены для показа работы продукта — "
          "это не результат проверки документа организаторов.")
        a("")
    a(f"> **Итог:** {READY_RU[r.readiness]}. {r.readiness_reason}  ")
    a(f"> Выделено требований: **{s.total_requirements}**, подтверждённых замечаний: **{s.findings_total}** "
      f"(🔴 {s.by_severity['CRITICAL']} · 🟠 {s.by_severity['HIGH']} · 🟡 {s.by_severity['MEDIUM']} · "
      f"🔵 {s.by_severity['LOW']}), «требует проверки»: {s.needs_review}, вопросов владельцу: {len(r.questions)}. "
      f"Индекс качества LÜMEN: **{s.quality_index}/100**.")
    a("")
    from .digest import build, short, where

    dg = build(r)
    if dg.fixes:
        a("## Коротко: что исправить в первую очередь")
        a("")
        a("| # | Проблема | Где | Как исправить |")
        a("| :---: | :--- | :--- | :--- |")
        for i, f in enumerate(dg.fixes, 1):
            how = f.rewrite or f.fix
            a(f"| {i} | {SEV_ICON[f.severity]} **{_c(f.title)}** — {_c(short(f.problem, 160))} | {where(f)}"
              f"{'; ' + ', '.join(f.req_ids[:3]) if f.req_ids else ''} | {_c(short(how, 200))} |")
        a("")
    if dg.questions:
        a("**Спросите у владельца требований:**")
        a("")
        for q in dg.questions:
            a(f"* ❓ {q.question} _({', '.join(q.req_ids[:3]) or 'весь документ'})_")
        a("")
    a(f"_Без замечаний {dg.clean} из {len(dg.heat)} требований. Цитаты сверены с исходным текстом, строки и страницы "
      f"вычислены по файлу. Ниже — полная доказательная часть._")
    a("")
    a("**Содержание:** [1. Паспорт прогона](#1-паспорт-прогона) · [2. Методика](#2-методика-проверки) · "
      "[3. Нарезка требований](#3-как-агент-нарезал-требования) · [4. Проверка каждого требования](#4-проверка-каждого-требования) · "
      "[5. Проверка набора](#5-проверка-всего-набора-требований) · [6. Вопросы владельцу](#6-вопросы-к-владельцу-требований) · "
      "[7. Сводка](#7-сводка) · [8. Итог](#8-итог-можно-ли-начинать-разработку-и-тестирование) · [Приложения](#приложения)")
    a("")

    # 1 passport
    a("## 1. Паспорт прогона")
    a("")
    a("| Параметр | Значение |")
    a("| :--- | :--- |")
    rows = [
        ("Название документа", f"«{p.document_title}»" if p.document_title else p.document_name),
        ("Файл", f"`{p.document_name}` ({p.document_format.upper()})"),
        ("SHA-256 файла", f"`{p.document_sha256}`"),
        ("Дата и время анализа", _dt(p.analysed_at)),
        ("Длительность", f"{p.duration_s:.1f} с"),
        ("Модель LLM", f"`{p.model}` — {PROVIDER_LABELS.get(p.provider, p.provider)}"),
        ("Режим анализа", MODE_RU[p.mode]),
        ("Версия агента", f"LÜMEN {p.agent_version}, коммит `{p.agent_commit}`"),
        ("Обращений к модели", f"{p.llm_calls} (ошибок/повторов: {p.llm_failures}); токены: вход "
                               f"{p.tokens_in:,}".replace(",", " ") + " · выход " + f"{p.tokens_out:,}".replace(",", " ")),
        ("Стандарты", "ISO/IEC/IEEE 29148:2018 (п. 5.2.5, 5.2.6); IEEE Std 830-1998 (п. 4.3)"),
        ("Идентификатор прогона", f"`{r.id}`"),
    ]
    for k, v in rows:
        a(f"| {k} | {_c(v)} |")
    a("")
    if r.warnings:
        a("**Предупреждения прогона:**")
        a("")
        for w in r.warnings:
            a(f"* ⚠️ {w}")
        a("")

    # 2 method
    a("## 2. Методика проверки")
    a("")
    a("Проверка статическая — ревью текста требований до разработки (программа не запускается). Конвейер LÜMEN Core:")
    a("")
    for e in sorted(r.stages, key=lambda e: e.index):
        icon = {"done": "✅", "skipped": "⏭️", "error": "⚠️", "running": "…"}[e.status]
        a(f"{e.index}. {icon} **{e.title}** — {e.message or e.status}")
    a("")
    a("**Защита от галлюцинаций.** Детерминированные правила (лексика, структура, API-контракт, единицы, заглушки) "
      "работают без модели. Ответы LLM принимаются только по строгой JSON-схеме (при невалидном ответе — повтор с "
      "описанием ошибки). Каждая цитата модели ищется в документе (точное и нечёткое совпадение ≥ 82%) и заменяется "
      "дословным фрагментом; при отсутствии совпадения замечание получает статус «требует проверки». Несуществующие "
      "ID требований отбрасываются. CRITICAL/HIGH-замечания модели проходят независимую перепроверку (роль "
      "скептичного ревьюера), которая может снизить критичность или отклонить дефект.")
    a("")
    a("**Критерии отдельного требования** (✅ выполнено · ❌ дефект · N/A неприменимо · «·» не оценено):")
    a("")
    a("| Сокр. | Критерий | Основание |")
    a("| :--- | :--- | :--- |")
    for k, (name, ref, _d, basis) in REQUIREMENT_CRITERIA.items():
        a(f"| {CRIT_ABBR[k]} | {name} | {ref}{'' if basis == 'normative' else ' (экспертная практика)'} |")
    a("")
    a("**Шкала критичности:** 🔴 CRITICAL — блокирует корректную реализацию или создаёт серьёзный риск; 🟠 HIGH — "
      "исправить до разработки; 🟡 MEDIUM — риск разной интерпретации/проблем тестирования; 🔵 LOW — улучшение; "
      "⚪ INFO — наблюдение. Нормативные замечания (по стандартам) отделены от экспертных FinTech-рекомендаций.")
    a("")

    # 3 segmentation
    a("## 3. Как агент нарезал требования")
    a("")
    explicit = sum(1 for x in r.requirements if x.source_id_kind == "explicit")
    a(f"Выделено **{len(r.requirements)}** требований; собственный идентификатор в документе есть у **{explicit}**. "
      "Требованиям без номера агент присвоил свои ID (REQ-NNN), для них указано место (раздел/пункт таблицы или "
      "списка) и сохранена цитата. Метаданные (общие сведения, чек-лист ревью, согласующие) не считаются требованиями, "
      "но проверяются на уровне набора.")
    a("")
    a("| ID в отчёте | ID в документе | Тип | Раздел | Место | Краткая формулировка | Цитата |")
    a("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for x in r.requirements:
        sid = x.source_id if x.source_id_kind == "explicit" else (f"нет ({x.source_id})" if x.source_id else "нет")
        loc = (f"строка {x.loc.line_start}" if x.loc.line_start == x.loc.line_end
               else f"строки {x.loc.line_start}–{x.loc.line_end}")
        if x.loc.page:
            loc = f"с. {x.loc.page}, " + loc
        a(f"| {x.id} | {_c(sid)} | {TYPE_RU.get(x.type, x.type)} | {_c(x.section)} | {loc} | {_c(x.summary)} | "
          f"«{_c(_q(x.quote, 220))}» |")
    a("")

    # 4 individual
    a("## 4. Проверка каждого требования")
    a("")
    a("### 4.1. Матрица критериев")
    a("")
    keys = list(REQUIREMENT_CRITERIA)
    a("| ID | Балл | " + " | ".join(CRIT_ABBR[k] for k in keys) + " |")
    a("| :--- | ---: | " + " | ".join(":---:" for _ in keys) + " |")
    amap = {x.req_id: x for x in r.assessments}
    for x in r.requirements:
        asm = amap[x.id]
        a(f"| {x.id} | {asm.score:.0f} | " + " | ".join(ST_ICON[asm.criteria.get(k, 'unknown')] for k in keys) + " |")
    a("")
    a("### 4.2. Замечания по требованиям")
    a("")
    by_req: dict[str, list[Finding]] = {}
    for f in r.findings:
        if f.scope == "requirement":
            for rid in f.req_ids[:1]:
                by_req.setdefault(rid, []).append(f)
    clean = []
    for x in r.requirements:
        fs = by_req.get(x.id, [])
        asm = amap[x.id]
        if not fs:
            clean.append(x.id)
            continue
        sid = f" ({x.source_id})" if x.source_id_kind == "explicit" else ""
        a(f"### {x.id}{sid} — {_c(x.summary)}")
        a("")
        a(f"*{TYPE_RU.get(x.type, x.type)} · {x.loc.label()} · балл {asm.score:.0f}/100 · вердикт: "
          f"{ {'pass': 'принято', 'warn': 'с замечаниями', 'fail': 'не принято'}[asm.verdict] }*")
        a("")
        a("> " + _q(x.quote, 700).replace("\n", "\n> "))
        a("")
        for f in sorted(fs, key=lambda f: SEVERITY_ORDER[f.severity]):
            L.extend(_finding_md(f))
    if clean:
        a(f"**Без замечаний ({len(clean)}):** {', '.join(clean)} — дефекты по проверенным критериям не обнаружены.")
        a("")

    # 5 set
    a("## 5. Проверка всего набора требований")
    a("")
    a("### 5.1. Свойства набора (ISO/IEC/IEEE 29148 п. 5.2.6, IEEE 830 п. 4.3)")
    a("")
    a("| Свойство | Основание | Статус | Замечания |")
    a("| :--- | :--- | :---: | :--- |")
    sst = set_criteria_status(r)
    for k, (name, ref, _d, _b) in SET_CRITERIA.items():
        ids = [f.id for f in conf if f.criterion == k]
        a(f"| {name} | {ref} | {ST_ICON[sst[k]]} | {', '.join(ids) or '—'} |")
    a("")
    groups = [
        ("5.2. Противоречия и согласованность", lambda f: f.criterion in ("set_consistent", "consistent", "terminology")),
        ("5.3. Полнота, пропущенные сценарии и проверяемость набора",
         lambda f: f.criterion in ("set_complete", "set_validatable", "set_feasible", "set_comprehensible")),
        ("5.4. Интеграционные контракты", lambda f: f.criterion == "integration_contract"),
        ("5.5. Структура, ранжирование, модифицируемость и прослеживаемость",
         lambda f: f.criterion in ("ranked", "modifiable", "set_traceable")),
    ]
    set_f = [f for f in r.findings if f.scope == "set" and f.criterion != "fintech"]
    used = set()
    for title, pred in groups:
        fs = [f for f in set_f if pred(f) and f.id not in used]
        a(f"### {title}")
        a("")
        if not fs:
            a("Дефектов не обнаружено." if r.passport.mode != "offline" or "Противоречия" not in title
              else "Правилами дефектов не обнаружено; смысловые противоречия оцениваются только в режиме LLM.")
            a("")
        for f in fs:
            used.add(f.id)
            L.extend(_finding_md(f))
    rest = [f for f in set_f if f.id not in used]
    for f in rest:
        L.extend(_finding_md(f))
    # relations
    a("### 5.6. Граф связей требований")
    a("")
    if r.relations:
        type_ru = {"depends_on": "зависит от", "conflicts_with": "противоречит", "duplicates": "дублирует",
                   "refines": "уточняет", "implements": "реализует", "traces_to": "прослеживается к"}
        a("```mermaid")
        a("graph LR")
        for rel in r.relations:
            arrow = "-.->" if rel.status != "confirmed" else ("--x" if rel.type == "conflicts_with" else "-->")
            a(f"  {rel.source.replace('-', '_')}[{rel.source}] {arrow}|{type_ru[rel.type]}| {rel.target.replace('-', '_')}[{rel.target}]")
        a("```")
        a("")
        a("| Откуда | Связь | Куда | Статус | Основание |")
        a("| :--- | :--- | :--- | :--- | :--- |")
        for rel in r.relations:
            a(f"| {rel.source} | {type_ru[rel.type]} | {rel.target} | "
              f"{'подтверждена' if rel.status == 'confirmed' else 'требует подтверждения'} | {_c(rel.note)} |")
        a("")
        linked = {x for rel in r.relations for x in (rel.source, rel.target)}
        orphan = [x.id for x in r.requirements if x.id not in linked and x.type in ("functional", "nonfunctional")]
        if orphan:
            a(f"Функциональные/нефункциональные требования без установленных связей: {', '.join(orphan)}.")
            a("")
    else:
        a("Связи между требованиями не установлены.")
        a("")
    # fintech
    a("### 5.7. FinTech-анализ (LÜMEN Risk Engine — экспертные рекомендации)")
    a("")
    a("Сначала оценивается применимость аспекта к документу; неприменимые аспекты не считаются дефектами.")
    a("")
    a("| Аспект | Применимость | Статус | Требования | Комментарий / рекомендация |")
    a("| :--- | :---: | :--- | :--- | :--- |")
    appl = {"yes": "да", "no": "нет", "unknown": "?"}
    for c in r.fintech:
        note = c.note + (f" → {c.recommendation}" if c.recommendation else "")
        a(f"| {c.aspect} | {appl[c.applicable]} | {FIN_ST[c.status]} | {', '.join(c.req_ids[:5]) or '—'} | {_c(note)} |")
    a("")
    for f in [f for f in r.findings if f.criterion == "fintech"]:
        L.extend(_finding_md(f))

    # 6 questions
    a("## 6. Вопросы к владельцу требований")
    a("")
    a("Сформированы LÜMEN Clarification Engine. Варианты ответа — предложения для обсуждения, а не подтверждённые факты.")
    a("")
    st_ru = {"open": "открыт", "clarified": "уточнён", "rejected": "отклонён"}
    for q in r.questions:
        a(f"**{q.id}** [{st_ru[q.status]}] · {', '.join(q.req_ids) or 'набор'} — **{q.question}**  ")
        a(f"*Зачем:* {q.why}" + (f" *Риск без ответа:* {q.risk}" if q.risk else "") + "  ")
        if q.options:
            a("*Варианты:* " + " · ".join(f"☐ {o}" for o in q.options) + "  ")
        if q.answer:
            a(f"*Ответ:* {q.answer}  ")
        if q.finding_ids:
            a(f"*Связанные замечания:* {', '.join(q.finding_ids)}")
        a("")

    # 7 summary
    a("## 7. Сводка")
    a("")
    a("| Показатель | Значение |")
    a("| :--- | ---: |")
    for k, v in [
        ("Выделено требований", s.total_requirements), ("Проверено требований", s.checked_requirements),
        ("Подтверждённых замечаний (нарушений)", s.findings_total),
        ("🔴 CRITICAL", s.by_severity["CRITICAL"]), ("🟠 HIGH", s.by_severity["HIGH"]),
        ("🟡 MEDIUM", s.by_severity["MEDIUM"]), ("🔵 LOW", s.by_severity["LOW"]), ("⚪ INFO", s.by_severity["INFO"]),
        ("Замечаний «требует проверки»", s.needs_review), ("Противоречий", s.contradictions),
        ("Непроверяемых формулировок", s.unverifiable), ("Неоднозначных формулировок", s.ambiguous),
        ("Неполных формулировок", s.incomplete), ("Открытых вопросов", s.open_questions),
        ("Индекс качества требований", f"{s.requirements_index}/100"), ("Индекс качества набора", f"{s.set_index}/100"),
        ("**Общий индекс качества LÜMEN**", f"**{s.quality_index}/100**"),
        ("Покрытие критериев оценками", f"{s.criteria_coverage:.0%}"),
    ]:
        a(f"| {k} | {v} |")
    a("")
    crit_list = [f for f in conf if f.severity in ("CRITICAL", "HIGH") and
                 (f.criterion in ("verifiable", "acceptance", "set_validatable", "consistent", "set_consistent",
                                  "complete", "set_complete", "correct", "integration_contract", "unambiguous")
                  or f.severity == "CRITICAL")]
    a("**Критичные дефекты (непроверяемые, противоречивые, неполные формулировки):**")
    a("")
    if crit_list:
        a("| # | Замечание | Критичность | Требования | Место | Суть |")
        a("| :--- | :--- | :--- | :--- | :--- | :--- |")
        for f in crit_list:
            a(f"| {f.id} | {_c(f.title)} | {SEV_ICON[f.severity]} {f.severity} | {', '.join(f.req_ids) or 'набор'} | "
              f"{_c(_where(f))} | {_c(_q(f.problem, 220))} |")
    else:
        a("Критичных дефектов не обнаружено.")
    a("")
    by_crit = Counter(criterion_name(f.criterion) for f in conf)
    a("**Распределение замечаний по критериям:** " + ", ".join(f"{k} — {v}" for k, v in by_crit.most_common()))
    a("")

    # 8 verdict
    a("## 8. Итог: можно ли начинать разработку и тестирование")
    a("")
    a(f"### {READY_RU[r.readiness]}")
    a("")
    a(r.readiness_reason)
    a("")
    dev_ok = r.readiness in ("READY", "READY WITH CONDITIONS")
    a(f"* **Разработка:** {'можно начинать после устранения HIGH-замечаний' if r.readiness == 'READY WITH CONDITIONS' else ('можно начинать' if dev_ok else 'начинать нельзя')}.")
    test_block = any(f.criterion in ("acceptance", "verifiable", "set_validatable") and f.severity in ("CRITICAL", "HIGH")
                     for f in conf)
    a(f"* **Тестирование:** {'начинать нельзя — нет полного набора проверяемых критериев приёмки' if test_block else ('можно готовить тест-дизайн' if dev_ok else 'начинать нельзя')}.")
    a("")
    a("**Что исправить в первую очередь:**")
    a("")
    for i, pr in enumerate(r.priorities, start=1):
        a(f"{i}. {pr}")
    a("")
    open_q = [q for q in r.questions if q.status == "open"]
    if open_q:
        a(f"Параллельно получить ответы владельца требований на {len(open_q)} вопросов раздела 6 "
          f"(в первую очередь: {', '.join(q.id for q in open_q[:5])}).")
        a("")

    # appendix
    a("## Приложения")
    a("")
    a("### А. Методика расчёта индексов (не является официальной оценкой по ISO)")
    a("")
    a(METHOD)
    a("")
    a("### Б. Каталог детерминированных правил, сработавших в прогоне")
    a("")
    rules = Counter(f.rule_id for f in r.findings if f.source.startswith("rule"))
    a(", ".join(f"`{k}` × {v}" for k, v in sorted(rules.items())) or "—")
    a("")
    a(f"---\n*{PRODUCT_NAME} · LÜMEN Core {__version__} · отчёт сформирован агентом автоматически.*")
    return "\n".join(L) + "\n"


# =========================================================================== HTML
_CSS = """
:root{--ink:#0E1A33;--soft:#344054;--mute:#667085;--line:#E4E8F0;--bg:#F5F7FB;--card:#fff;--blue:#1F4FD8;--violet:#6E3FF3;
--crit:#D92D20;--high:#E8620C;--med:#C99A06;--low:#3B82F6;--info:#98A2B3;--ok:#12B76A}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:980px;margin:0 auto;padding:0 20px 60px}
header{background:var(--ink);color:#fff;padding:28px 0 76px}header .wrap{padding-bottom:0}
.brand{font-size:12px;letter-spacing:.06em;color:#9FB3D9}h1{margin:6px 0 4px;font-size:28px;line-height:1.2}
.sub{color:#C7D2E8;font-size:13px}
.hero{display:grid;grid-template-columns:1fr 200px;gap:14px;margin-top:-56px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.verdict{border-left:5px solid var(--v)}.verdict b.lbl{display:block;font-size:26px;color:var(--v);line-height:1.1}
.verdict p{margin:6px 0 0}.verdict .why{color:var(--mute);font-size:14px}
.ring{display:grid;place-items:center;text-align:center}
.ring .g{width:120px;height:120px;border-radius:50%;display:grid;place-items:center;
background:conic-gradient(var(--v) calc(var(--p)*1%),var(--line) 0)}
.ring .g div{width:94px;height:94px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:30px;font-weight:700}
.ring small{color:var(--mute);font-size:12px;margin-top:6px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.kpi b{display:block;font-size:26px;line-height:1.1}.kpi span{color:var(--mute);font-size:13px}
.bar{display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--line)}.bar i{display:block}
.legend{font-size:12px;color:var(--mute);margin-top:6px}.dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 4px 0 10px}
h2{font-size:21px;margin:34px 0 12px}
.fix{display:grid;grid-template-columns:34px 1fr;gap:8px;border-left:4px solid var(--c);margin-bottom:10px}
.fix .n{font-size:22px;font-weight:700;color:var(--c)}.fix h3{margin:0;font-size:16px}
.meta{color:var(--mute);font-size:12.5px}.fix p{margin:6px 0}
.how{background:#EEF3FF;border-radius:8px;padding:8px 12px;font-size:14px}.how b{color:var(--blue)}
.qs{list-style:none;padding:0;margin:0}.qs li{display:grid;grid-template-columns:24px 1fr;padding:10px 0;border-bottom:1px solid var(--line)}
.qs li:before{content:"?";font-weight:700;color:var(--violet)}
.heat{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:4px}
.heat a{display:block;text-decoration:none;border-radius:6px;padding:6px 4px;text-align:center;font-size:11.5px;line-height:1.3;color:var(--ink);background:#E7F6EE}
.heat a b{display:block}.heat a.CRITICAL,.heat a.HIGH,.heat a.LOW{color:#fff}
.CRITICAL{--c:var(--crit)}.HIGH{--c:var(--high)}.MEDIUM{--c:var(--med)}.LOW{--c:var(--low)}.INFO{--c:var(--info)}
.heat a.CRITICAL,.heat a.HIGH,.heat a.MEDIUM,.heat a.LOW{background:var(--c)}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}
th{color:var(--mute);font-weight:600;font-size:12.5px}
.tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}
.tools button{border:1px solid var(--line);background:#fff;border-radius:99px;padding:5px 12px;cursor:pointer;font:inherit;font-size:13px}
.tools button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.tools input{flex:1;min-width:180px;border:1px solid var(--line);border-radius:99px;padding:6px 14px;font:inherit;font-size:13px}
details.f{background:#fff;border:1px solid var(--line);border-left:4px solid var(--c);border-radius:10px;margin-bottom:8px}
details.f summary{cursor:pointer;padding:10px 14px;list-style:none}details.f summary::-webkit-details-marker{display:none}
details.f summary b{font-weight:600}details.f .body{padding:0 14px 12px}
.sev{display:inline-block;font-size:11px;font-weight:700;color:#fff;background:var(--c);border-radius:5px;padding:1px 6px;margin-right:6px}
blockquote{margin:8px 0;padding:8px 12px;background:var(--bg);border-radius:8px;color:var(--soft);font-size:13.5px;white-space:pre-wrap}
dl{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;margin:8px 0 0;font-size:14px}dt{color:var(--mute)}dd{margin:0}
.rev{font-size:11px;background:#FEF3C7;color:#92400E;border-radius:5px;padding:1px 6px;margin-left:6px}
details.ap{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:8px}
details.ap>summary{cursor:pointer;padding:12px 16px;font-weight:600}details.ap>div{padding:0 16px 14px;overflow:auto}
.demo{background:#FEF3C7;border:1px solid #F59E0B;padding:10px 14px;border-radius:10px;margin:14px 0}
.warn{color:#B54708;font-size:13px}.mx td{text-align:center}.mx td:first-child{text-align:left}
footer{color:var(--mute);font-size:12px;text-align:center;margin-top:30px}
@media(max-width:700px){.hero{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}dl{grid-template-columns:1fr}h1{font-size:22px}}
@media print{.tools{display:none}details{break-inside:avoid}details.f .body,details.ap>div{display:block}header{padding-bottom:70px}}
"""

_VHEX = {"READY": "#12B76A", "READY WITH CONDITIONS": "#DC9A06", "NOT READY": "#D92D20", "INSUFFICIENT DATA": "#667085"}


def _e(x) -> str:
    return _html.escape(str(x or ""))


def _finding_html(f: Finding) -> str:
    from .digest import SEV_SHORT, short, where

    rows = [("Критерий", f"{criterion_name(f.criterion)} — {f.standard_ref or '—'} "
                         f"({'нормативное' if f.basis == 'normative' else 'экспертное'})"),
            ("Где", where(f) + (f"; требования: {', '.join(f.req_ids)}" if f.req_ids else "")),
            ("Что не так", f.problem), ("Риск", f.risk), ("Как исправить", f.fix),
            ("Улучшенная формулировка", f.rewrite)]
    dl = "".join(f"<dt>{_e(k)}</dt><dd>{_e(v)}</dd>" for k, v in rows if v)
    rev = '<span class="rev">требует проверки</span>' if f.status != "confirmed" else ""
    q = f"<blockquote>{_e(_q(f.quote, 900))}</blockquote>" if f.quote else ""
    text = _e(" ".join([f.id, f.title, f.problem, *f.req_ids]).lower())
    return (f'<details class="f {f.severity}" data-sev="{f.severity}" data-text="{text}" id="{_e(f.id)}"><summary>'
            f'<span class="sev">{SEV_SHORT[f.severity]}</span><b>{_e(f.title)}</b>{rev}'
            f'<div class="meta">{_e(f.id)} · {_e(where(f))}{" · " + _e(", ".join(f.req_ids[:4])) if f.req_ids else ""} · '
            f'{_e(short(f.problem, 140))}</div></summary><div class="body">{q}<dl>{dl}</dl></div></details>')


def render_html(r: AuditResult) -> str:
    """Decision first (verdict, top fixes, questions, map), then filterable evidence; methodology is collapsed."""
    from .digest import SEV_SHORT, VERDICT, build, short, where

    p, s = r.passport, r.scores
    d = build(r)
    vlabel, vtext = VERDICT[r.readiness]
    vhex = _VHEX[r.readiness]
    amap = {x.req_id: x for x in r.assessments}
    by_req: dict[str, str] = {}
    for f in r.findings:
        for rid in f.req_ids:
            by_req.setdefault(rid, f.id)
    H: list[str] = []
    h = H.append
    title = p.document_title or p.document_name
    h(f"<!DOCTYPE html><html lang='ru'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
      f"<title>LÜMEN — {_e(title)}</title><style>{_CSS}</style></head><body style='--v:{vhex}'>")
    h(f"<header><div class='wrap'><div class='brand'>LÜMEN · ПРОВЕРКА ТРЕБОВАНИЙ</div><h1>{_e(title)}</h1>"
      f"<div class='sub'>{_e(_dt(p.analysed_at))} · {_e(p.model)} · {_e(MODE_RU[p.mode])}</div></div></header><div class='wrap'>")
    h(f"<div class='hero'><div class='card verdict'><b class='lbl'>{vlabel}</b><p><b>{_e(vtext)}</b></p>"
      f"<p class='why'>{_e(r.readiness_reason)}</p></div>"
      f"<div class='card ring'><div class='g' style='--p:{max(0, min(100, s.quality_index)):.0f}'><div>{s.quality_index:.0f}</div></div>"
      f"<small>индекс качества из 100</small></div></div>")
    if r.demo:
        h("<div class='demo'>Демонстрационный прогон — не результат проверки документа организаторов.</div>")
    sev = s.by_severity
    h("<div class='kpis'>" + "".join(
        f"<div class='card kpi'><b style='color:{c}'>{n}</b><span>{lbl}</span></div>" for n, lbl, c in [
            (s.total_requirements, "требований", "var(--ink)"), (sev["CRITICAL"], "критичных", "var(--crit)"),
            (sev["HIGH"], "высоких", "var(--high)"), (s.open_questions, "открытых вопросов", "var(--violet)")]) + "</div>")
    tot = sum(sev[k] for k in ("CRITICAL", "HIGH", "MEDIUM", "LOW")) or 1
    h("<div class='bar'>" + "".join(f"<i class='{k}' style='width:{sev[k] / tot * 100:.2f}%;background:var(--c)'></i>"
                                    for k in ("CRITICAL", "HIGH", "MEDIUM", "LOW") if sev[k]) + "</div>")
    h(f"<div class='legend'>Замечаний {s.findings_total}:" + "".join(
        f"<span class='dot {k}' style='background:var(--c)'></span>{sev[k]} {SEV_SHORT[k].lower()}"
        for k in ("CRITICAL", "HIGH", "MEDIUM", "LOW") if sev[k]) + "</div>")
    for w in r.warnings:
        h(f"<p class='warn'>⚠ {_e(w)}</p>")

    if d.fixes:
        h("<h2>Исправьте в первую очередь</h2>")
        for i, f in enumerate(d.fixes, 1):
            how = f.rewrite or f.fix
            h(f"<div class='card fix {f.severity}'><div class='n'>{i}</div><div><h3>{_e(f.title)}</h3>"
              f"<div class='meta'>{SEV_SHORT[f.severity]} · {_e(where(f))}"
              f"{' · ' + _e(', '.join(f.req_ids[:3])) if f.req_ids else ''} · <a href='#{_e(f.id)}'>подробнее</a></div>"
              f"<p>{_e(short(f.problem, 220))}</p>"
              + (f"<div class='how'><b>{'Как написать' if f.rewrite else 'Как исправить'}:</b> {_e(short(how, 300))}</div>" if how else "")
              + "</div></div>")
    if d.questions:
        h("<h2>Спросите у владельца требований</h2><div class='card'><ul class='qs'>")
        for q in d.questions:
            h(f"<li><div>{_e(q.question)}<div class='meta'>{_e(', '.join(q.req_ids[:3]) or 'весь документ')}</div></div></li>")
        h("</ul></div>")
    h(f"<h2>Карта требований</h2><p class='meta'>Цвет — самое серьёзное замечание, число — балл требования. "
      f"Без замечаний: {d.clean} из {len(d.heat)}. Нажмите на клетку, чтобы открыть замечание.</p><div class='heat'>")
    for rid, sv, sc in d.heat:
        h(f"<a class='{sv}' href='#{_e(by_req.get(rid, ''))}' title='{_e(rid)}'><b>{_e(rid)}</b>{sc:.0f}</a>")
    h("</div>")
    if d.fintech_gaps:
        h("<h2>FinTech: чего не хватает</h2><div class='card'><table><tr><th>Аспект</th><th>Статус</th><th>Что добавить</th></tr>")
        for a, st, rec in d.fintech_gaps:
            h(f"<tr><td>{_e(a)}</td><td>{'не описано' if st == 'missing' else 'частично'}</td><td>{_e(rec)}</td></tr>")
        h("</table></div>")

    h(f"<h2>Все замечания ({len(r.findings)})</h2><div class='tools'>"
      + "".join(f"<button data-f='{k}' class='on'>{SEV_SHORT[k]} {sum(1 for f in r.findings if f.severity == k)}</button>"
                for k in SEVERITY_ORDER if any(f.severity == k for f in r.findings))
      + "<input type='search' placeholder='Поиск: термин, REQ-012, GET…' aria-label='Поиск по замечаниям'></div>")
    for f in sorted(r.findings, key=lambda f: SEVERITY_ORDER[f.severity]):
        h(_finding_html(f))
    if r.questions:
        st_ru = {"open": "открыт", "clarified": "уточнён", "rejected": "отклонён"}
        h(f"<h2>Все вопросы владельцу ({len(r.questions)})</h2><div class='card'><table><tr><th>№</th><th>Вопрос</th><th>Статус</th></tr>")
        for q in r.questions:
            opts = (" <span class='meta'>Варианты: " + _e(" / ".join(q.options)) + "</span>") if q.options else ""
            ans = f"<div><b>Ответ:</b> {_e(q.answer)}</div>" if q.answer else ""
            h(f"<tr><td>{_e(q.id)}</td><td>{_e(q.question)}<div class='meta'>{_e(q.why)}</div>{opts}{ans}</td>"
              f"<td>{st_ru[q.status]}</td></tr>")
        h("</table></div>")

    # appendix (organizers' structure: passport, method, segmentation, per-requirement matrix, set, relations, fintech)
    h("<h2>Приложение</h2>")
    h("<details class='ap'><summary>Паспорт прогона</summary><div><table>")
    for k, v in [("Документ", title), ("Файл", f"{p.document_name} ({p.document_format})"), ("SHA-256", p.document_sha256),
                 ("Дата анализа", _dt(p.analysed_at)), ("Модель", f"{p.model} — {PROVIDER_LABELS.get(p.provider, p.provider)}"),
                 ("Режим", MODE_RU[p.mode]), ("Версия агента", f"LÜMEN {p.agent_version}, коммит {p.agent_commit}"),
                 ("Длительность", f"{p.duration_s:.1f} с"), ("Обращений к модели", p.llm_calls), ("ID прогона", r.id)]:
        h(f"<tr><th>{_e(k)}</th><td>{_e(v)}</td></tr>")
    h("</table></div></details>")
    h("<details class='ap'><summary>Методика</summary><div><ol>"
      + "".join(f"<li>{_e(e.title)} — {_e(e.message or e.status)}</li>" for e in sorted(r.stages, key=lambda e: e.index))
      + f"</ol><p class='meta'>{_e(METHOD)}</p></div></details>")
    h(f"<details class='ap'><summary>Нарезка требований ({len(r.requirements)})</summary><div><table>"
      "<tr><th>ID</th><th>В документе</th><th>Тип</th><th>Место</th><th>Формулировка</th></tr>")
    for x in r.requirements:
        sid = x.source_id if x.source_id_kind == "explicit" else "—"
        h(f"<tr><td>{_e(x.id)}</td><td>{_e(sid)}</td><td>{_e(TYPE_RU.get(x.type, x.type))}</td><td>{_e(x.loc.label())}</td>"
          f"<td>{_e(x.summary)}</td></tr>")
    h("</table></div></details>")
    keys = list(REQUIREMENT_CRITERIA)
    h("<details class='ap'><summary>Матрица критериев по требованиям</summary><div><table class='mx'><tr><th>ID</th><th>Балл</th>"
      + "".join(f"<th title='{_e(REQUIREMENT_CRITERIA[k][0])}'>{CRIT_ABBR[k]}</th>" for k in keys) + "</tr>")
    for x in r.requirements:
        a = amap.get(x.id)
        if a:
            h(f"<tr><td>{_e(x.id)}</td><td>{a.score:.0f}</td>" + "".join(f"<td>{ST_ICON[a.criteria.get(k, 'unknown')]}</td>" for k in keys) + "</tr>")
    h("</table></div></details>")
    sst = set_criteria_status(r)
    h("<details class='ap'><summary>Свойства набора (ISO/IEC/IEEE 29148 п. 5.2.6, IEEE 830 п. 4.3)</summary><div><table>"
      "<tr><th>Свойство</th><th>Основание</th><th>Статус</th></tr>")
    for k, (name, ref, _d, _b) in SET_CRITERIA.items():
        h(f"<tr><td>{_e(name)}</td><td>{_e(ref)}</td><td>{ST_ICON[sst[k]]}</td></tr>")
    h("</table></div></details>")
    if r.relations:
        type_ru = {"depends_on": "зависит от", "conflicts_with": "противоречит", "duplicates": "дублирует",
                   "refines": "уточняет", "implements": "реализует", "traces_to": "прослеживается к"}
        h(f"<details class='ap'><summary>Связи требований ({len(r.relations)})</summary><div><table>"
          "<tr><th>Откуда</th><th>Связь</th><th>Куда</th><th>Основание</th></tr>")
        for rel in r.relations:
            h(f"<tr><td>{_e(rel.source)}</td><td>{_e(type_ru.get(rel.type, rel.type))}</td><td>{_e(rel.target)}</td><td>{_e(rel.note)}</td></tr>")
        h("</table></div></details>")
    h("<details class='ap'><summary>FinTech: все аспекты</summary><div><table><tr><th>Аспект</th><th>Применимость</th>"
      "<th>Статус</th><th>Комментарий</th></tr>")
    for c in r.fintech:
        h(f"<tr><td>{_e(c.aspect)}</td><td>{_e(c.applicable)}</td><td>{_e(FIN_ST[c.status])}</td><td>{_e(c.note)} {_e(c.recommendation)}</td></tr>")
    h("</table></div></details>")
    h(f"<footer>{PRODUCT_NAME} · LÜMEN Core {__version__} · коммит {_e(p.agent_commit)}</footer></div>")
    h("""<script>(()=>{const bs=[...document.querySelectorAll('.tools button')],inp=document.querySelector('.tools input');
const apply=()=>{const on=bs.filter(b=>b.classList.contains('on')).map(b=>b.dataset.f),q=(inp&&inp.value||'').toLowerCase().trim();
document.querySelectorAll('details.f').forEach(f=>{f.style.display=on.includes(f.dataset.sev)&&(!q||f.dataset.text.includes(q))?'':'none'})};
bs.forEach(b=>b.onclick=()=>{b.classList.toggle('on');apply()});if(inp)inp.oninput=apply;
const open=()=>{const t=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(t&&t.tagName==='DETAILS')t.open=true};
addEventListener('hashchange',open);open();
addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true));})();</script></body></html>""")
    return "".join(H)
