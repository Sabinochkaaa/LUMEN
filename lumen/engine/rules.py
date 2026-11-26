"""Deterministic Quality Auditor — fast, explainable, reproducible lexical & structural checks.

LLM is used for semantics; everything that can be decided by a rule is decided here, so the
agent produces a meaningful, evidence-backed result even without a model (offline mode).
"""
from __future__ import annotations

import re
from collections import defaultdict

from ..models import Document, Finding, Location, Question, Relation, Requirement
from .criteria import criterion_basis, criterion_ref
from .evidence import EvidenceIndex
from .extractor import Extraction

VAGUE_TERMS = [
    r"быстр\w*", r"оперативн\w*", r"своевременн\w*", r"удобн\w*", r"интуитивн\w*", r"эффективн\w*",
    r"над[её]жн\w*", r"гибк\w*", r"оптимальн\w*", r"достаточн\w*", r"приемлем\w*", r"разумн\w*",
    r"современн\w*", r"качественн\w*", r"адекватн\w*", r"мгновенн\w*", r"незамедлительн\w*",
    r"при необходимости", r"по возможности", r"и т\.\s?д\.", r"и т\.\s?п\.", r"и др\.", r"примерно",
    r"как правило", r"обычно", r"некотор\w+", r"нескольк\w+", r"в кратчайш\w+", r"максимально\b",
    r"минимально\b", r"user[- ]friendly", r"\bfast\b", r"\bquick(ly)?\b", r"\beasy\b", r"\befficient\w*",
    r"\brobust\b", r"\bflexible\b", r"\bappropriate\b", r"\badequate\b", r"\betc\.?", r"\bas needed\b",
    r"\bif possible\b", r"\bapproximately\b", r"\bsufficient\b", r"\bseamless\w*",
]
VAGUE_RE = re.compile(r"(?<![\w-])(" + "|".join(VAGUE_TERMS) + r")", re.I)
WEAK_RE = re.compile(r"(?<![\w-])(может|могут|желательно|по желанию|рекомендуется|следует|should|may|could|might|optional\w*)(?![\w-])", re.I)
ANDOR_RE = re.compile(r"\bи/или\b|\band/or\b", re.I)
TIME_RE = re.compile(r"\d*\s*(секунд\w*|сек\b|минут\w*|мин\b|мс\b|ms\b|час\w*|seconds?|minutes?)", re.I)
LOAD_RE = re.compile(r"(перцентил|percentile|\bp9\d|%|\brps\b|\btps\b|нагрузк|одновременн|в пике|peak)", re.I)
CITY_TIME_RE = re.compile(
    r"((?:в|по)\s+(?:Алматы|Астан\w*|Москв\w*|Ташкент\w*|Бишкек\w*|Минск\w*)|по местному времени|local time)", re.I
)
DATE_WORDS_RE = re.compile(r"(месяц|сутк|день|дн[яи]|дат\w|month|day|date|календарн)", re.I)
MUTATE_RE = re.compile(
    r"(save|create|update|delete|remove|set[A-Z_]|add[A-Z_]|сохран|созда|измен|удал|обнов|запис|заменя)", re.I
)
MINOR_MAJOR = [
    (re.compile(r"тиын\w*|tiyn", re.I), re.compile(r"тенге|₸|\bKZT\b", re.I), "тиын", "тенге"),
    (re.compile(r"копе\w+|kopeck", re.I), re.compile(r"рубл\w+|₽|\bRUB\b", re.I), "копейки", "рубли"),
    (re.compile(r"цент\w*|\bcents?\b", re.I), re.compile(r"доллар\w*|\$|\bUSD\b", re.I), "центы", "доллары"),
]
TABLE_ROW_RE = re.compile(r"^[^\n:;]{1,40}:\s[^\n]*;\s[^\n:;]{1,40}:")
HTTP_PHRASES = {
    "ok": 200, "created": 201, "accepted": 202, "no content": 204, "bad request": 400, "unauthorized": 401,
    "forbidden": 403, "not found": 404, "conflict": 409, "unprocessable": 422, "too many requests": 429,
    "internal server error": 500, "service unavailable": 503,
}


class RuleContext:
    def __init__(self, doc: Document, ex: Extraction, ev: EvidenceIndex):
        self.doc = doc
        self.ex = ex
        self.ev = ev
        self.findings: list[Finding] = []
        self.questions: list[Question] = []
        self.relations: list[Relation] = []
        self.doc_text = "\n".join(l.text for l in doc.lines)

    # ------------------------------------------------------------------ helpers
    def quote_for(self, req: Requirement, pattern: re.Pattern | str) -> tuple[str, Location]:
        rx = re.compile(pattern, re.I) if isinstance(pattern, str) else pattern
        for no in range(req.loc.line_start, req.loc.line_end + 1):
            frag = self.ev.line_text(no)
            if rx.search(frag):
                sentences = re.split(r"(?<=[.!?])\s+", frag)
                hit = next((s for s in sentences if rx.search(s)), frag)
                return hit.strip(), self.ev.location(no, no)
        return req.quote[:300], req.loc

    def add(self, *, req_ids, criterion, severity, title, quote, loc, problem, risk, fix, rule_id,
            rewrite="", scope="requirement", confidence=1.0, basis=None):
        self.findings.append(
            Finding(
                scope=scope, req_ids=list(req_ids), criterion=criterion, severity=severity, title=title,
                quote=quote, loc=loc, problem=problem, risk=risk, fix=fix, rewrite=rewrite, source="rule",
                rule_id=rule_id, basis=basis or criterion_basis(criterion), standard_ref=criterion_ref(criterion),
                confidence=confidence,
            )
        )

    def ask(self, req_ids, question, why, risk, options, rule_id):
        self.questions.append(Question(req_ids=list(req_ids), question=question, why=why, risk=risk,
                                       options=options, source=f"rule:{rule_id}"))


# ====================================================================== per-requirement rules
def requirement_rules(ctx: RuleContext) -> None:
    for r in ctx.ex.requirements:
        text = r.quote
        # R1 vague terms
        seen = set()
        for m in VAGUE_RE.finditer(text):
            term = m.group(1).lower()
            if term in seen:
                continue
            seen.add(term)
            q, loc = ctx.quote_for(r, re.escape(m.group(1)))
            sev = "HIGH" if r.type == "nonfunctional" else "MEDIUM"
            ctx.add(
                req_ids=[r.id], criterion="unambiguous", severity=sev, rule_id="R-VAGUE",
                title=f"Нечёткая формулировка «{m.group(1)}»", quote=q, loc=loc,
                problem=f"Слово «{m.group(1)}» не имеет измеримого значения и толкуется по-разному.",
                risk="Разработка и тестирование примут разные пороги; приёмка станет предметом спора.",
                fix=f"Заменить «{m.group(1)}» измеримым показателем (число, единица, условие измерения).",
            )
            ctx.ask([r.id], f"Какое измеримое значение подразумевается под «{m.group(1)}» в {r.id}"
                    f"{' (' + r.source_id + ')' if r.source_id_kind == 'explicit' else ''}?",
                    "Без числового критерия требование нельзя проверить тестом.",
                    "Каждая команда подставит своё значение, приёмка будет субъективной.",
                    ["Задать конкретное число с единицей измерения", "Сослаться на SLA/стандарт банка",
                     "Удалить слово, если оно декоративное"], "R-VAGUE")
        # R2 weak modality
        mw = WEAK_RE.search(text)
        if mw and r.type not in ("acceptance",):
            q, loc = ctx.quote_for(r, re.escape(mw.group(1)))
            ctx.add(
                req_ids=[r.id], criterion="unambiguous", severity="LOW", rule_id="R-WEAK",
                title=f"Неопределённая обязательность («{mw.group(1)}»)", quote=q, loc=loc,
                problem="Модальное слово не позволяет понять, обязательно ли поведение.",
                risk="Функция может быть не реализована или реализована частично без нарушения формулировки.",
                fix="Использовать однозначную форму: «Система должна…» / «Система не должна…».",
            )
        # R3 and/or
        if ANDOR_RE.search(text):
            q, loc = ctx.quote_for(r, ANDOR_RE)
            ctx.add(req_ids=[r.id], criterion="unambiguous", severity="LOW", rule_id="R-ANDOR",
                    title="Конструкция «и/или»", quote=q, loc=loc,
                    problem="«и/или» оставляет выбор комбинации на усмотрение исполнителя.",
                    risk="Неполная реализация, расхождение тестов.", fix="Явно перечислить допустимые комбинации.")
        # R4 atomicity
        if r.type not in ("api", "acceptance") and "\n" not in text:
            sentences = [s for s in re.split(r"(?<=[.!?])\s+", text) if len(s.split()) >= 3]
            if len(sentences) >= 3:
                ctx.add(req_ids=[r.id], criterion="singular", severity="LOW", rule_id="R-ATOMIC",
                        title=f"Неатомарное требование ({len(sentences)} утверждения)",
                        quote=_short(text), loc=r.loc,
                        problem=f"В одном пункте объединены {len(sentences)} самостоятельных утверждения.",
                        risk="Сложно трассировать к тестам и частично принимать; изменения затрагивают всё сразу.",
                        fix="Разбить на отдельные пронумерованные требования, по одному проверяемому утверждению.")
        # R5 inline empty values ("Prod: —")
        for m in [] if TABLE_ROW_RE.match(text) else re.finditer(r"([A-Za-zА-Яа-яЁё][\w ]{1,30}):\s*[—–-]\s*(?:[.;|]|$)", text, re.M):
            q, loc = ctx.quote_for(r, re.escape(m.group(1).strip()) + r"\W{0,6}[—–-]")
            ctx.add(req_ids=[r.id], criterion="complete", severity="MEDIUM", rule_id="R-EMPTY-VALUE",
                    title=f"Не заполнено значение «{m.group(1).strip()}»", quote=q, loc=loc,
                    problem=f"Поле «{m.group(1).strip()}» оставлено пустым (прочерк).",
                    risk="Исполнитель не получит необходимые данные; интеграция/выпуск будут заблокированы.",
                    fix=f"Заполнить «{m.group(1).strip()}» или явно указать «не применимо» с обоснованием.")
        # R6 mixed currency units inside one requirement
        for minor, major, mn, mj in MINOR_MAJOR:
            if minor.search(text) and major.search(text):
                q, loc = ctx.quote_for(r, minor)
                ctx.add(req_ids=[r.id], criterion="consistent", severity="MEDIUM", rule_id="R-UNITS",
                        title=f"Смешение денежных единиц ({mn} и {mj})", quote=q, loc=loc,
                        problem=f"В одном требовании величины заданы в разных единицах: {mn} и {mj}.",
                        risk="Ошибка масштаба ×100 при сравнении суммы с порогом — ложные или пропущенные уведомления.",
                        fix=f"Хранить и сравнивать все суммы в одной минимальной единице ({mn}), "
                            f"явно описать преобразование для отображения.", basis="normative")
                ctx.ask([r.id], f"Подтвердите единицу хранения и сравнения сумм в {r.id}: {mn} или {mj}?",
                        "Сравнение величин в разных единицах — классический источник ошибки ×100.",
                        "Порог сработает на неверной сумме.",
                        [f"Всё хранить в {mn}", f"Всё хранить в {mj} (целые)", "Хранить в разных, описав конвертацию"],
                        "R-UNITS")
        # R7 timezone / calendar boundary
        if CITY_TIME_RE.search(text) and DATE_WORDS_RE.search(text) and not re.search(r"UTC|GMT|часов\w* пояс", ctx.doc_text, re.I):
            q, loc = ctx.quote_for(r, CITY_TIME_RE)
            ctx.add(req_ids=[r.id], criterion="unambiguous", severity="LOW", rule_id="R-TZ",
                    title="Часовой пояс задан городом, без смещения UTC", quote=q, loc=loc,
                    problem="Граница суток/месяца привязана к городу, но не указано смещение UTC и источник времени.",
                    risk="Покупки около полуночи попадут не в тот месяц при расхождении часовых поясов серверов.",
                    fix="Указать часовой пояс явно (например, UTC+5, IANA Asia/Almaty) и источник метки времени события.",
                    basis="expert")
            ctx.ask([r.id], f"Какой часовой пояс (смещение UTC) и какая метка времени события используются в {r.id}?",
                    "Определяет, в какой месяц попадёт операция у границы суток.",
                    "Расхождение счётчиков с выпиской клиента.",
                    ["UTC+5 (Asia/Almaty), время авторизации", "UTC+5, время проведения (клиринга)", "Другое"], "R-TZ")
        # R8 NFR without load profile / measurement point
        if r.type == "nonfunctional" and TIME_RE.search(text) and not LOAD_RE.search(text):
            q, loc = ctx.quote_for(r, TIME_RE)
            ctx.add(req_ids=[r.id], criterion="verifiable", severity="MEDIUM", rule_id="R-NFR-PROFILE",
                    title="Временное ограничение без профиля нагрузки и доли запросов", quote=q, loc=loc,
                    problem="Не указаны нагрузка, перцентиль и точки начала/окончания измерения.",
                    risk="Требование «выполнено» на одном событии и нарушено под пиковой нагрузкой.",
                    fix="Добавить: при нагрузке N событий/с, для 95–99% событий, время от T1 (получение) до T2 (передача).")


def _short(text: str, limit: int = 260) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    return t if len(t) <= limit else t[: limit - 1] + "…"


# ====================================================================== API contract linter
def _kv(req: Requirement) -> dict[str, tuple[str, int]]:
    out = {}
    for offset, line in enumerate(req.quote.split("\n")):
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip().lower()] = (v.strip(), req.loc.line_start + offset)
    return out


def api_rules(ctx: RuleContext) -> None:
    reqs = ctx.ex.requirements
    api = [r for r in reqs if r.type == "api"]
    if not api:
        return
    # --- method vs semantics
    for r in api:
        if "\n" not in r.quote:
            continue
        kv = _kv(r)
        method = next((v for k, v in kv.items() if re.search(r"rest type|http method|метод|^method", k)), None)
        url = next((v for k, v in kv.items() if re.search(r"url|endpoint|путь", k) and "type" not in k), None)
        desc = next((v for k, v in kv.items() if re.search(r"description|описание|назначение", k)), None)
        if method and method[0].strip().upper() == "GET":
            evidence = " ".join(x[0] for x in (url, desc) if x)
            if MUTATE_RE.search(evidence):
                line = method[1]
                ctx.add(req_ids=[r.id], criterion="correct", severity="HIGH", rule_id="API-GET-MUTATION",
                        title="Изменяющая операция объявлена через GET", quote=ctx.ev.line_text(line),
                        loc=ctx.ev.location(line, line),
                        problem="Метод сохраняет состояние, но объявлен как GET (безопасный и идемпотентный по RFC 9110).",
                        risk="Кэширование/предзагрузка прокси и браузеров может повторно изменить настройку; "
                             "параметры попадают в URL и логи; повышается риск CSRF.",
                        fix="Использовать PUT (замена настройки) или POST, параметры передавать в теле JSON.",
                        rewrite="REST type: PUT; Request URL: /alerts/limit; тело: {\"cardId\", \"amount\", \"enabled\"}.")
                ctx.ask([r.id], f"Допустимо ли заменить GET на PUT/POST для операции сохранения в {r.id}?",
                        "GET не должен менять состояние сервера.", "Непредсказуемые повторные изменения и утечки в логи.",
                        ["PUT /alerts/limit (идемпотентная замена)", "POST /alerts/limit", "Оставить GET (обосновать)"],
                        "API-GET-MUTATION")
        for k, (v, line) in kv.items():
            if v in ("—", "-", "–", "", "n/a") and not re.search(r"примечан|comment", k):
                ctx.add(req_ids=[r.id], criterion="complete", severity="MEDIUM", rule_id="API-EMPTY-FIELD",
                        title=f"Пустое поле контракта «{k}»", quote=ctx.ev.line_text(line), loc=ctx.ev.location(line, line),
                        problem=f"Поле «{k}» не заполнено.",
                        risk="Неполный контракт: потребители API не смогут интегрироваться или сверить реализацию.",
                        fix=f"Заполнить «{k}» или указать «не применимо» с причиной.")
    # --- status codes
    defined: dict[int, int] = {}
    for b in ctx.doc.blocks:
        m = re.match(r"^(\d{3})\.?\s", b.text)
        if m and b.kind in ("paragraph", "heading", "list_item") and _in_api(ctx, b.section_path):
            defined.setdefault(int(m.group(1)), b.loc.line_start)
    if defined:
        for b in ctx.doc.blocks:
            if not _in_api(ctx, b.section_path) or b.kind == "code":
                continue
            for m in re.finditer(r"(?:возвращ\w*|return\w*|код\w*|статус\w*|status)\s+(\d{3})\b", b.text, re.I):
                code = int(m.group(1))
                if code not in defined:
                    rid = ctx.ev.req_for_line(b.loc.line_start)
                    ctx.add(req_ids=rid, criterion="integration_contract", severity="MEDIUM", rule_id="API-UNDEFINED-STATUS",
                            title=f"Статус {code} используется, но не описан в перечне статусов",
                            quote=_sentence(b.text, m.group(0)), loc=b.loc, scope="requirement" if rid else "set",
                            problem=f"Текст ссылается на код {code}, которого нет в разделе статусов.",
                            risk="Клиент не обработает код; тестировщики не знают ожидаемого тела ответа.",
                            fix=f"Добавить {code} в перечень статусов с условием и примером тела.")
            # any well-known HTTP code mentioned in prose but absent from the statuses list
            if b.kind in ("paragraph", "list_item") and not re.match(r"^\d{3}\b", b.text):
                for m in re.finditer(r"(?<!\d )(?<![\d.,])\b(20[0-46]|40[0-49]|41[0-5]|42[2-9]|50[0-4])\b(?!\s?\d)", b.text):
                    code = int(m.group(1))
                    if code in defined or any(f.rule_id == "API-UNDEFINED-STATUS" and str(code) in f.title for f in ctx.findings):
                        continue
                    rid = ctx.ev.req_for_line(b.loc.line_start)
                    ctx.add(req_ids=rid, criterion="integration_contract", severity="MEDIUM", rule_id="API-UNDEFINED-STATUS",
                            title=f"Статус {code} упоминается, но не описан в перечне статусов",
                            quote=_sentence(b.text, m.group(0)), loc=b.loc, scope="requirement" if rid else "set",
                            problem=f"Текст ссылается на код {code}, однако в разделе статусов нет его условия и тела ответа.",
                            risk="Клиент и тестировщики не знают, когда возникает этот код и что в нём приходит.",
                            fix=f"Описать {code} в перечне статусов (условие, пример тела) или убрать упоминание.")
            # heading with code X but text says another code is returned
            head = b.section_path[-1] if b.section_path else ""
            hm = re.match(r"^(\d{3})", head)
            if hm and b.kind in ("paragraph", "list_item"):
                for m in re.finditer(r"возвращ\w*\s+(\d{3})", b.text, re.I):
                    if m.group(1) != hm.group(1):
                        rid = ctx.ev.req_for_line(b.loc.line_start)
                        ctx.add(req_ids=rid, criterion="consistent", severity="MEDIUM", rule_id="API-STATUS-SECTION",
                                title=f"Раздел статуса {hm.group(1)} описывает возврат {m.group(1)}",
                                quote=_sentence(b.text, m.group(0)), loc=b.loc,
                                problem=f"В разделе «{head}» указано, что возвращается {m.group(1)}.",
                                risk="Неясно, когда возникает статус из заголовка; противоречивый контракт.",
                                fix=f"Определить условия для {hm.group(1)} и {m.group(1)} раздельно или удалить неиспользуемый.")
    for b in ctx.doc.blocks:
        if b.kind != "heading":
            continue
        m = re.match(r"^(\d{3})\.?\s+(.*)$", b.text)
        if not m:
            continue
        code, label = int(m.group(1)), m.group(2).lower()
        for phrase, pcode in HTTP_PHRASES.items():
            if re.search(r"\b" + re.escape(phrase) + r"\b", label) and pcode != code and not (phrase == "ok" and code == 200):
                ctx.add(req_ids=[], scope="set", criterion="integration_contract", severity="LOW", rule_id="API-STATUS-LABEL",
                        title=f"Код {code} подписан как «{phrase.title()}» ({pcode})", quote=b.text, loc=b.loc,
                        problem=f"Заголовок объединяет код {code} и фразу статуса {pcode}.",
                        risk="Неоднозначно, какой код вернёт сервис при успешном создании/сохранении.",
                        fix=f"Оставить один код: {code} или {pcode}, и привести примеры к нему.")
        # success code with error payload
        if 200 <= code < 300:
            sec = b.text
            for cb in ctx.ex.code_blocks:
                if cb.section_path and cb.section_path[-1] == sec and re.search(r"\"?(result|status)\"?\s*:\s*\"?(error|fail)", cb.text, re.I):
                    ctx.add(req_ids=[], scope="set", criterion="consistent", severity="HIGH", rule_id="API-SUCCESS-WITH-ERROR",
                            title=f"Ошибка бизнес-валидации возвращается со статусом {code}",
                            quote=cb.text.strip(), loc=cb.loc,
                            problem=f"В примерах успешного ответа {code} приведено тело с результатом ERROR.",
                            risk="Клиенты, проверяющие только HTTP-код, сочтут отклонённое сохранение успешным; "
                                 "мониторинг ошибок не увидит отказов.",
                            fix="Возвращать ошибку валидации с 400/422 и телом {\"message\": …}; 200 — только при успехе.")
                    ctx.ask([], f"Каким HTTP-кодом должен завершаться отказ валидации суммы: {code} с result=ERROR или 400/422?",
                            "Документ одновременно относит ERROR к успешному ответу и описывает 400 для неверных параметров.",
                            "Разная обработка ошибок в приложении и сервисе.",
                            ["400 Bad Request", "422 Unprocessable Entity", f"{code} + result=ERROR (обосновать)"],
                            "API-SUCCESS-WITH-ERROR")
                    break
    # --- Content-Type JSON but no body
    for r in api:
        if re.search(r"content-type:\s*application/json", r.quote, re.I):
            sib = [x for x in api if x.section == r.section and re.search(r"тело не используется|без тела|body is not used|no body", x.quote, re.I)]
            if sib:
                ctx.add(req_ids=[r.id, sib[0].id], criterion="consistent", severity="LOW", rule_id="API-CT-NOBODY",
                        title="Content-Type: application/json при отсутствии тела запроса",
                        quote=r.quote.strip(), loc=r.loc,
                        problem="Объявлен JSON-формат тела, но тело не используется.",
                        risk="Неоднозначность для клиентов и шлюзов; признак незавершённого контракта.",
                        fix="Либо перенести параметры в тело JSON, либо убрать Content-Type.")
    # --- parameter type mismatches between tables
    params: dict[str, list[tuple[str, Requirement]]] = defaultdict(list)
    for r in api:
        m = re.match(r"^(?:Parameter|Параметр|Поле|Name|Имя)\s*:\s*([\w.\-]+);.*?(?:Format|Формат|Type|Тип)\s*:\s*([\w\- ]+?)(?:;|$)", r.quote, re.I)
        if m:
            params[m.group(1)].append((m.group(2).strip().lower(), r))
    for name, items in params.items():
        fmts = {f for f, _ in items}
        if len(fmts) > 1:
            rs = [x for _, x in items]
            ctx.add(req_ids=[x.id for x in rs], criterion="consistent", severity="MEDIUM", rule_id="API-TYPE-MISMATCH",
                    title=f"Параметр «{name}» имеет разные типы: {', '.join(sorted(fmts))}",
                    quote=ctx.ev.line_text(rs[0].loc.line_start), loc=rs[0].loc,
                    problem=f"«{name}» описан как {' и '.join(f'{f} ({x.id})' for f, x in items)}.",
                    risk="Ошибки сериализации/парсинга, потеря точности сумм, разная валидация на клиенте и сервере.",
                    fix=f"Определить единый тип «{name}» в запросе и ответе (для денег — integer в минимальных единицах).")


def _in_api(ctx: RuleContext, path: list[str]) -> bool:
    from .extractor import section_kind

    return section_kind(path) == "api"


def _sentence(text: str, fragment: str) -> str:
    for s in re.split(r"(?<=[.!?])\s+", text):
        if fragment in s:
            return s.strip()
    return text.strip()[:300]


# ====================================================================== set-level rules
PRIORITY_RE = re.compile(r"(приоритет|priority|must have|should have|moscow|критичн\w+ для бизнес|обязательн\w+/желательн)", re.I)
VERSION_RE = re.compile(r"(верси[яи]\s*[:№|]?\s*\d|version\s*[:#|]?\s*\d|v\d+\.\d+|ред(акция)?\.\s*\d)", re.I)


def set_rules(ctx: RuleContext) -> None:
    ex, reqs = ctx.ex, ctx.ex.requirements
    text = ctx.doc_text
    # empty / placeholder sections
    for b in ex.placeholders:
        if b.kind == "table_row":
            continue
        sev = "HIGH" if re.search(r"тест|прием|приём|acceptance|test", " ".join(b.section_path), re.I) else "MEDIUM"
        ctx.add(req_ids=[], scope="set", criterion="set_validatable" if sev == "HIGH" else "set_complete",
                severity=sev, rule_id="SET-PLACEHOLDER", title=f"Раздел «{b.loc.section}» не заполнен",
                quote=b.text, loc=b.loc,
                problem=f"Вместо содержимого раздела — заглушка «{b.text}».",
                risk="Отсутствуют данные, необходимые для разработки или приёмки; набор нельзя валидировать.",
                fix=f"Заполнить раздел «{b.loc.section}» до передачи в разработку.")
    # unfilled checklist in meta sections ("Да / Нет" templates)
    tmpl = [b for b in ex.meta_blocks if b.kind == "table_row" and re.search(r"да\s*/\s*нет", b.text, re.I)]
    if tmpl:
        first, last = tmpl[0], tmpl[-1]
        ctx.add(req_ids=[], scope="set", criterion="set_validatable", severity="MEDIUM", rule_id="SET-CHECKLIST",
                title=f"Чек-лист ревью не заполнен ({len(tmpl)} пунктов с шаблонными «Да / Нет»)",
                quote=ctx.ev.line_text(first.loc.line_start),
                loc=Location(line_start=first.loc.line_start, line_end=last.loc.line_end, page=first.loc.page,
                             section=first.loc.section),
                problem="Пункты чек-листа ревью оставлены в шаблонном виде, решения по ним не приняты.",
                risk="Нет подтверждения тестируемости, отката, согласования ИБ и архитектуры.",
                fix="Проставить отметки по каждому пункту и приложить подтверждения (ссылки, ФИО, даты).")
    empty_sign = [b for b in ex.meta_blocks if b.kind == "table_row" and re.search(r"согласу|подпис|approv", " ".join(b.section_path), re.I)
                  and not any(c.strip() for c in b.cells)]
    if empty_sign:
        b = empty_sign[0]
        ctx.add(req_ids=[], scope="set", criterion="set_traceable", severity="MEDIUM", rule_id="SET-APPROVERS",
                title="Блок согласующих пуст", quote=ctx.ev.line_text(b.loc.line_start) or "| | | |", loc=b.loc,
                problem="Не указаны подразделения и ответственные за согласование.",
                risk="Невозможно подтвердить, что изменения согласованы с владельцами систем и ИБ.",
                fix="Указать подразделения, ФИО и дату согласования.")
    elif not re.search(r"согласу|согласован|утвержд|approv|sign-?off", text, re.I):
        ctx.add(req_ids=[], scope="set", criterion="set_traceable", severity="LOW", rule_id="SET-APPROVERS",
                title="Не указаны согласующие документа", quote="", loc=None,
                problem="В документе нет блока согласования: неизвестно, кто подтвердил требования.",
                risk="Требования могут уйти в разработку без согласования с владельцами систем, ИБ и бизнесом.",
                fix="Добавить блок «Согласующие»: подразделения, ФИО, дата и статус согласования.")
    # version
    vm = re.search(r"[^.\n]*верси[^.\n]*не заполнен[^.\n]*\.?", text, re.I)
    if vm:
        frag = vm.group(0).strip()
        match = ctx.ev.find(frag)
        ctx.add(req_ids=[], scope="set", criterion="modifiable", severity="MEDIUM", rule_id="SET-VERSION",
                title="Версия и дата документа не зафиксированы", quote=match.text if match else frag,
                loc=ctx.ev.location(match.line_start, match.line_end) if match else None,
                problem="Документ не имеет версии/даты.",
                risk="Невозможно сослаться на согласованную редакцию; отчёт проверки нельзя привязать к версии.",
                fix="Добавить лист изменений: версия, дата, автор, описание изменений.")
    elif not VERSION_RE.search(text):
        ctx.add(req_ids=[], scope="set", criterion="modifiable", severity="LOW", rule_id="SET-VERSION",
                title="В документе не найдена версия", quote="", loc=None,
                problem="Не найдено обозначение версии документа.", risk="Сложно управлять изменениями.",
                fix="Добавить номер версии и историю изменений.")
    # ranking
    if not PRIORITY_RE.search(text) and reqs:
        ctx.add(req_ids=[], scope="set", criterion="ranked", severity="MEDIUM", rule_id="SET-RANK",
                title="Требования не ранжированы по важности/стабильности", quote="", loc=None,
                problem=f"Ни для одного из {len(reqs)} требований не указан приоритет или стабильность.",
                risk="При ограничении сроков невозможно согласованно решить, что реализовать первым.",
                fix="Добавить атрибут приоритета (например, MoSCoW) и стабильности к каждому требованию.")
    # traceability: share of requirements without explicit identifiers
    no_id = [r for r in reqs if r.source_id_kind != "explicit"]
    if reqs and len(no_id) / len(reqs) > 0.5:
        sections = sorted({r.section.split(" / ")[-1] for r in no_id})[:8]
        ctx.add(req_ids=[], scope="set", criterion="set_traceable", severity="MEDIUM", rule_id="SET-IDS",
                title=f"{len(no_id)} из {len(reqs)} требований без собственных идентификаторов",
                quote="", loc=None,
                problem="Идентификаторы есть только у части требований; остальные описаны прозой/таблицами "
                        f"(разделы: {', '.join(sections)}).",
                risk="Невозможно однозначно ссылаться на требования в задачах, тестах и согласованиях.",
                fix="Присвоить уникальные идентификаторы всем требованиям (НФ-, Д-, И-, API-…).")
    # cross-requirement currency units (minor in one, major in another)
    for minor, major, mn, mj in MINOR_MAJOR:
        with_minor = [r for r in reqs if minor.search(r.quote)]
        with_major = [r for r in reqs if major.search(r.quote) and not minor.search(r.quote)]
        if with_minor and with_major and not any(f.rule_id == "R-UNITS" for f in ctx.findings):
            a = with_minor[0]
            q, loc = ctx.quote_for(a, minor)
            ctx.add(req_ids=[a.id] + [x.id for x in with_major[:3]], scope="set", criterion="set_consistent",
                    severity="MEDIUM", rule_id="SET-UNITS", title=f"Суммы описаны в разных единицах ({mn} и {mj})",
                    quote=q, loc=loc, problem=f"{a.id} использует {mn}, другие требования — {mj}.",
                    risk="Ошибки масштаба ×100.", fix=f"Зафиксировать единую единицу ({mn}) для всех сумм.")
    # duplicates: sentence-level stem similarity across different sections
    def sentences(r):
        if TABLE_ROW_RE.match(r.quote):
            return []
        body = re.sub(r"«[^»]*»", " ", r.quote)
        return [s for s in re.split(r"(?<=[.!?])\s+|\n", body) if len(_stems(s)) >= 4]
    sents = {r.id: sentences(r) for r in reqs}
    reported = set()
    for i, a in enumerate(reqs):
        for b in reqs[i + 1:]:
            if a.section == b.section or (a.id, b.id) in reported:
                continue
            best = 0.0
            for sa in sents[a.id]:
                for sb in sents[b.id]:
                    x, y = _stems(sa), _stems(sb)
                    best = max(best, len(x & y) / len(x | y))
            if best >= 0.55:
                reported.add((a.id, b.id))
                ctx.relations.append(Relation(source=b.id, target=a.id, type="duplicates", status="needs_confirmation",
                                              note=f"Сходство формулировок {best:.0%}"))
                ctx.add(req_ids=[a.id, b.id], scope="set", criterion="modifiable", severity="LOW", rule_id="SET-DUP",
                        title=f"Возможное дублирование {a.id} и {b.id}", quote=ctx.ev.line_text(b.loc.line_start),
                        loc=b.loc, confidence=round(best, 2),
                        problem=f"Правило в {b.id} повторяет {a.id} (сходство формулировок {best:.0%}).",
                        risk="При изменении одного места второе останется прежним — рассинхронизация документов.",
                        fix=f"Оставить правило в одном месте, во втором — ссылку на {a.id}.")
    ids = {r.source_id: r.id for r in reqs if r.source_id_kind == "explicit" and r.source_id and re.search(r"\d", r.source_id)}
    for r in reqs:
        for sid, rid in ids.items():
            if rid != r.id and re.search(r"(?<![\w-])" + re.escape(sid) + r"(?![\w-])", r.quote):
                ctx.relations.append(Relation(source=r.id, target=rid, type="refines" if r.type == "acceptance" else "depends_on",
                                              status="confirmed", note=f"Явная ссылка на {sid}"))
    titles = re.findall(r"«([^»]{8,120})»", text)
    for t in set(titles):
        holders = [r for r in reqs if f"«{t}»" in r.quote or t in r.quote]
        if len(holders) >= 2:
            for h in holders[1:]:
                ctx.relations.append(Relation(source=holders[0].id, target=h.id, type="traces_to", status="confirmed",
                                              note=f"Ссылка на документ «{t}»"))


def _stems(text: str) -> set[str]:
    stop = {"при", "для", "что", "как", "или", "это", "все", "его", "она", "они", "если", "после", "через", "который"}
    return {w[:5] for w in re.findall(r"[а-яёa-z]{4,}", text.lower()) if w not in stop}


def term_rules(ctx: RuleContext, max_terms: int = 7) -> None:
    """R-TERM: domain terms with known ambiguity that the document never defines → finding + question."""
    from ..knowledge.glossary import TERMS, defined_in_document

    req_text = "\n".join(r.quote for r in ctx.ex.requirements).lower()
    n = 0
    for t in TERMS:
        if not t.ask or n >= max_terms:
            continue
        rx = re.compile(t.pattern, re.I)
        if not rx.search(req_text) or (t.context and not re.search(t.context, req_text, re.I)):
            continue
        if defined_in_document(t, ctx.doc_text):
            continue
        holder = next((r for r in ctx.ex.requirements if rx.search(r.quote)), None)
        if holder is None:
            continue
        users = [r.id for r in ctx.ex.requirements if rx.search(r.quote)]
        q, loc = ctx.quote_for(holder, rx)
        ctx.add(req_ids=users[:6], criterion="unambiguous", severity=t.severity, rule_id=f"R-TERM-{t.key}",
                title=f"Термин «{t.term}» не определён в документе", quote=q, loc=loc, basis="expert",
                problem=f"{t.definition} В документе термин используется ({', '.join(users[:6])}), но не определён.",
                risk="Разработка, тестирование и бизнес поймут термин по-разному; расхождение всплывёт только на приёмке.",
                fix=f"Добавить определение «{t.term}» в раздел терминов и использовать его единообразно.")
        ctx.ask(users[:6], t.ask, f"Термин «{t.term}» допускает несколько толкований (справочник LÜMEN).",
                "Неверное толкование приведёт к переделке логики и критериев приёмки.", list(t.options), f"R-TERM-{t.key}")
        n += 1


def run_rules(doc: Document, ex: Extraction, ev: EvidenceIndex) -> RuleContext:
    ctx = RuleContext(doc, ex, ev)
    requirement_rules(ctx)
    api_rules(ctx)
    set_rules(ctx)
    term_rules(ctx)
    return ctx
