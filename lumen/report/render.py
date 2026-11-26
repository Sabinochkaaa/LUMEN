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
from ..engine.fintech import ASPECTS
from ..engine.scoring import METHOD
from ..models import SEVERITY_ORDER, SEVERITY_RU, AuditResult, Finding

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
    req_by_id = {x.id: x for x in r.requirements}
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
    a(f"Отчёт сформирован автоматически агентом **{PRODUCT_NAME}** (LÜMEN Core {p.agent_version}). Каждое замечание "
      "привязано к месту документа; цитаты программно сверены с исходным текстом, номера строк и страниц вычислены "
      "по файлу, а не взяты из ответа модели.")
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
:root{--bg:#f4f6fb;--card:#fff;--ink:#0f172a;--mute:#64748b;--line:#e2e8f0;--blue:#2563eb;--sky:#0ea5e9;--vio:#7c3aed;
--crit:#dc2626;--high:#ea580c;--med:#ca8a04;--low:#2563eb;--info:#94a3b8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,-apple-system,Segoe UI,Roboto,sans-serif}
header{background:linear-gradient(120deg,#0b1b4d,#1e3a8a 55%,#4c1d95);color:#fff;padding:40px 48px}
header .brand{letter-spacing:.3em;font-size:12px;opacity:.8}header h1{margin:8px 0 6px;font-size:28px}
header .sub{opacity:.85}.wrap{max-width:1180px;margin:0 auto;padding:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin:-48px 0 20px}
.kpi{background:var(--card);border-radius:14px;padding:16px 18px;box-shadow:0 8px 30px rgba(15,23,42,.08)}
.kpi b{display:block;font-size:26px}.kpi span{color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
section{background:var(--card);border-radius:16px;padding:22px 26px;margin:18px 0;box-shadow:0 2px 10px rgba(15,23,42,.05)}
h2{margin-top:0;font-size:20px}h3{font-size:16px;margin:22px 0 8px}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}th{background:#f8fafc;font-weight:600}
blockquote{margin:8px 0;padding:8px 14px;border-left:3px solid var(--sky);background:#f0f9ff;border-radius:0 8px 8px 0;white-space:pre-wrap}
.f{border:1px solid var(--line);border-left:5px solid var(--info);border-radius:10px;padding:12px 16px;margin:12px 0}
.f.CRITICAL{border-left-color:var(--crit)}.f.HIGH{border-left-color:var(--high)}.f.MEDIUM{border-left-color:var(--med)}.f.LOW{border-left-color:var(--low)}
.f h4{margin:0 0 6px;font-size:15px}.f dl{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;margin:6px 0 0}.f dt{color:var(--mute)}.f dd{margin:0}
.b{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:700;color:#fff;background:var(--info)}
.b.CRITICAL{background:var(--crit)}.b.HIGH{background:var(--high)}.b.MEDIUM{background:var(--med)}.b.LOW{background:var(--low)}
.rev{background:#fef3c7;color:#92400e}.ready{font-size:20px;font-weight:700;padding:14px 18px;border-radius:12px;background:#eef2ff}
.ready.NOT{background:#fee2e2;color:#991b1b}.ready.COND{background:#fef9c3;color:#854d0e}.ready.OK{background:#dcfce7;color:#166534}
nav{position:sticky;top:0;background:rgba(244,246,251,.92);backdrop-filter:blur(8px);padding:10px 24px;z-index:5;font-size:13px;border-bottom:1px solid var(--line)}
nav a{color:var(--blue);margin-right:14px;text-decoration:none}.filters button{border:1px solid var(--line);background:#fff;border-radius:99px;padding:4px 12px;margin:2px;cursor:pointer}
.filters button.on{background:var(--blue);color:#fff}.mute{color:var(--mute)}.mx td{text-align:center}.mx td:first-child{text-align:left}
.demo{background:#fef3c7;border:1px solid #f59e0b;padding:10px 14px;border-radius:10px;margin:12px 0}
@media print{nav,.filters{display:none}header{padding:20px}.grid{margin-top:10px}section{box-shadow:none;break-inside:avoid-page}}
"""


def _e(x) -> str:
    return _html.escape(str(x or ""))


def _finding_html(f: Finding) -> str:
    rows = [("Критерий", f"{criterion_name(f.criterion)} — {f.standard_ref or '—'} "
                         f"({'нормативное' if f.basis == 'normative' else 'экспертное'})"),
            ("Где", _where(f) + (f"; требования: {', '.join(f.req_ids)}" if f.req_ids else "")),
            ("Что не так", f.problem), ("Риск", f.risk), ("Как исправить", f.fix),
            ("Улучшенная формулировка", f.rewrite)]
    dl = "".join(f"<dt>{_e(k)}</dt><dd>{_e(v)}</dd>" for k, v in rows if v)
    rev = ' <span class="b rev">требует проверки</span>' if f.status != "confirmed" else ""
    q = f"<blockquote>{_e(_q(f.quote, 900))}</blockquote>" if f.quote else ""
    return (f'<div class="f {f.severity}" data-sev="{f.severity}"><h4><span class="b {f.severity}">{f.severity}</span> '
            f'{_e(f.id)} · {_e(f.title)}{rev}</h4>{q}<dl>{dl}</dl></div>')


def render_html(r: AuditResult) -> str:
    p, s = r.passport, r.scores
    cls = {"NOT READY": "NOT", "READY WITH CONDITIONS": "COND", "READY": "OK"}.get(r.readiness, "")
    amap = {x.req_id: x for x in r.assessments}
    H: list[str] = []
    h = H.append
    h(f"<!DOCTYPE html><html lang='ru'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
      f"<title>LÜMEN — отчёт: {_e(p.document_title or p.document_name)}</title><style>{_CSS}</style></head><body>")
    h(f"<header><div class='brand'>LÜMEN REQUIREMENTS INTELLIGENCE</div><h1>Отчёт о проверке требований</h1>"
      f"<div class='sub'>«{_e(p.document_title or p.document_name)}» · {_e(_dt(p.analysed_at))} · {_e(p.model)}</div></header>")
    h("<nav><a href='#passport'>Паспорт</a><a href='#segm'>Нарезка</a><a href='#req'>Требования</a><a href='#set'>Набор</a>"
      "<a href='#fin'>FinTech</a><a href='#q'>Вопросы</a><a href='#sum'>Сводка</a><a href='#verdict'>Итог</a></nav><div class='wrap'>")
    h("<div class='grid'>" + "".join(
        f"<div class='kpi'><span>{k}</span><b>{v}</b></div>" for k, v in [
            ("Индекс качества", f"{s.quality_index}"), ("Требований", s.total_requirements),
            ("Замечаний", s.findings_total), ("Critical", s.by_severity["CRITICAL"]), ("High", s.by_severity["HIGH"]),
            ("Вопросов", len(r.questions))]) + "</div>")
    if r.demo:
        h("<div class='demo'>⚠️ <b>Демонстрационный прогон</b> — не результат проверки документа организаторов.</div>")
    h(f"<section id='verdict0'><div class='ready {cls}'>{_e(READY_RU[r.readiness])}</div><p>{_e(r.readiness_reason)}</p></section>")
    # passport
    h("<section id='passport'><h2>1. Паспорт прогона</h2><table>")
    for k, v in [("Документ", p.document_title or p.document_name), ("Файл", f"{p.document_name} ({p.document_format})"),
                 ("SHA-256", p.document_sha256), ("Дата анализа", _dt(p.analysed_at)),
                 ("Модель", f"{p.model} — {PROVIDER_LABELS.get(p.provider, p.provider)}"), ("Режим", MODE_RU[p.mode]),
                 ("Версия агента", f"LÜMEN {p.agent_version}, коммит {p.agent_commit}"),
                 ("Длительность", f"{p.duration_s:.1f} с"), ("Обращений к модели", p.llm_calls)]:
        h(f"<tr><th>{_e(k)}</th><td>{_e(v)}</td></tr>")
    h("</table>" + "".join(f"<p class='mute'>⚠️ {_e(w)}</p>" for w in r.warnings) + "</section>")
    # segmentation
    h(f"<section id='segm'><h2>3. Нарезка требований ({len(r.requirements)})</h2><table><tr><th>ID</th><th>ID в документе</th>"
      "<th>Тип</th><th>Место</th><th>Краткая формулировка</th></tr>")
    for x in r.requirements:
        sid = x.source_id if x.source_id_kind == "explicit" else "—"
        h(f"<tr><td><a href='#{x.id}'>{x.id}</a></td><td>{_e(sid)}</td><td>{_e(TYPE_RU.get(x.type, x.type))}</td>"
          f"<td>{_e(x.loc.label())}</td><td>{_e(x.summary)}</td></tr>")
    h("</table></section>")
    # matrix + per req
    keys = list(REQUIREMENT_CRITERIA)
    h("<section id='req'><h2>4. Проверка каждого требования</h2><div class='filters'>Фильтр: "
      + "".join(f"<button data-f='{k}' class='on'>{k}</button>" for k in SEVERITY_ORDER) + "</div>")
    h("<div style='overflow:auto'><table class='mx'><tr><th>ID</th><th>Балл</th>" +
      "".join(f"<th title='{_e(REQUIREMENT_CRITERIA[k][0])}'>{CRIT_ABBR[k]}</th>" for k in keys) + "</tr>")
    for x in r.requirements:
        a = amap[x.id]
        h(f"<tr><td>{x.id}</td><td>{a.score:.0f}</td>" + "".join(f"<td>{ST_ICON[a.criteria.get(k, 'unknown')]}</td>" for k in keys) + "</tr>")
    h("</table></div>")
    by_req: dict[str, list[Finding]] = {}
    for f in r.findings:
        if f.scope == "requirement" and f.req_ids:
            by_req.setdefault(f.req_ids[0], []).append(f)
    for x in r.requirements:
        fs = by_req.get(x.id, [])
        sid = f" ({_e(x.source_id)})" if x.source_id_kind == "explicit" else ""
        h(f"<h3 id='{x.id}'>{x.id}{sid} — {_e(x.summary)} <span class='mute'>· {_e(x.loc.label())} · балл {amap[x.id].score:.0f}</span></h3>"
          f"<blockquote>{_e(_q(x.quote, 700))}</blockquote>")
        h("".join(_finding_html(f) for f in fs) or "<p class='mute'>Замечаний нет.</p>")
    h("</section>")
    # set
    sst = set_criteria_status(r)
    h("<section id='set'><h2>5. Проверка всего набора</h2><table><tr><th>Свойство</th><th>Основание</th><th>Статус</th></tr>")
    for k, (name, ref, _d, _b) in SET_CRITERIA.items():
        h(f"<tr><td>{_e(name)}</td><td>{_e(ref)}</td><td>{ST_ICON[sst[k]]}</td></tr>")
    h("</table>")
    h("".join(_finding_html(f) for f in r.findings if f.scope == "set" and f.criterion != "fintech"))
    type_ru = {"depends_on": "зависит от", "conflicts_with": "противоречит", "duplicates": "дублирует",
               "refines": "уточняет", "implements": "реализует", "traces_to": "прослеживается к"}
    if r.relations:
        h("<h3>Граф связей</h3><table><tr><th>Откуда</th><th>Связь</th><th>Куда</th><th>Статус</th><th>Основание</th></tr>")
        for rel in r.relations:
            h(f"<tr><td>{rel.source}</td><td>{type_ru[rel.type]}</td><td>{rel.target}</td>"
              f"<td>{'подтверждена' if rel.status == 'confirmed' else 'требует подтверждения'}</td><td>{_e(rel.note)}</td></tr>")
        h("</table>")
    h("</section>")
    h("<section id='fin'><h2>FinTech-анализ (LÜMEN Risk Engine)</h2><table><tr><th>Аспект</th><th>Применимость</th><th>Статус</th><th>Комментарий</th></tr>")
    for c in r.fintech:
        h(f"<tr><td>{_e(c.aspect)}</td><td>{_e(c.applicable)}</td><td>{_e(FIN_ST[c.status])}</td><td>{_e(c.note)} {_e(c.recommendation)}</td></tr>")
    h("</table>" + "".join(_finding_html(f) for f in r.findings if f.criterion == "fintech") + "</section>")
    h("<section id='q'><h2>6. Вопросы к владельцу требований</h2>")
    for q in r.questions:
        opts = "".join(f"<li>{_e(o)}</li>" for o in q.options)
        h(f"<div class='f'><h4>{q.id} · {_e(', '.join(q.req_ids) or 'набор')} · {_e(q.status)}</h4><b>{_e(q.question)}</b>"
          f"<dl><dt>Зачем</dt><dd>{_e(q.why)}</dd><dt>Риск</dt><dd>{_e(q.risk)}</dd>"
          f"{'<dt>Ответ</dt><dd>' + _e(q.answer) + '</dd>' if q.answer else ''}</dl><ul>{opts}</ul></div>")
    h("</section>")
    h("<section id='sum'><h2>7. Сводка</h2><table>")
    for k, v in [("Требований", s.total_requirements), ("Замечаний", s.findings_total),
                 *[(sev, s.by_severity[sev]) for sev in SEVERITY_ORDER], ("Требует проверки", s.needs_review),
                 ("Противоречий", s.contradictions), ("Непроверяемых", s.unverifiable), ("Неполных", s.incomplete),
                 ("Индекс требований", s.requirements_index), ("Индекс набора", s.set_index),
                 ("Общий индекс", s.quality_index)]:
        h(f"<tr><th>{_e(k)}</th><td>{_e(v)}</td></tr>")
    h(f"</table><p class='mute'>{_e(METHOD)}</p></section>")
    h(f"<section id='verdict'><h2>8. Итог</h2><div class='ready {cls}'>{_e(READY_RU[r.readiness])}</div><p>{_e(r.readiness_reason)}</p><ol>"
      + "".join(f"<li>{_e(x)}</li>" for x in r.priorities) + "</ol></section>")
    h(f"<p class='mute' style='text-align:center'>{PRODUCT_NAME} · LÜMEN Core {__version__}</p></div>")
    h("""<script>document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{b.classList.toggle('on');
const on=[...document.querySelectorAll('.filters button.on')].map(x=>x.dataset.f);
document.querySelectorAll('.f[data-sev]').forEach(f=>f.style.display=on.includes(f.dataset.sev)?'':'none')});</script></body></html>""")
    return "".join(H)
