"""Requirement Extractor: blocks → atomic, identified requirement records with verbatim quotes."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models import Block, Document, Location, Requirement

EXPLICIT_ID = re.compile(
    r"^\s*(?P<id>(?:[A-ZА-ЯЁ]{1,6}[A-ZА-ЯЁ0-9]*[-‐–_.]?\d+(?:\.\d+)*)|(?:\d+\.\d+(?:\.\d+)*))[.):]?\s+(?P<rest>.+)$"
)

META_KEYS = (
    "общие сведения", "общая информация", "паспорт документа", "история изменений", "лист изменений",
    "revision", "change log", "glossary", "глоссарий", "термины и определения", "содержание", "оглавление",
    "contents", "ревью требований", "чек-лист", "checklist", "согласующ", "согласовани", "approval",
    "подпис", "sign-off", "document info", "general information",
)

SECTION_TYPES: list[tuple[tuple[str, ...], str]] = [
    (("нефункциональн", "non-functional", "nonfunctional", "качеств", "производительн", "sla"), "nonfunctional"),
    (("функциональн", "functional"), "functional"),
    (("критерии прием", "критерии приём", "acceptance"), "acceptance"),
    (("требования к данным", "модель данных", "data"), "data"),
    (("интеграц", "integration"), "integration"),
    (("параметры запроса", "query", "path-", "request", "ответ", "response", "статус", "status",
      "логика работы метода", "особые правила", "общие параметры", "rest", "api", "endpoint"), "api"),
    (("ui", "ux", "дизайн", "экран", "интерфейс"), "ui"),
    (("sequence", "bpmn", "процесс", "архитектур", "схема"), "architecture"),
    (("цел", "goal", "objective", "бизнес-требован"), "business_goal"),
    (("безопасн", "security"), "security"),
    (("тестирован", "testing"), "testing"),
]

TYPE_RU = {
    "functional": "Функциональное",
    "nonfunctional": "Нефункциональное",
    "acceptance": "Критерий приёмки",
    "data": "Данные",
    "integration": "Интеграция",
    "api": "API-контракт",
    "ui": "UI/UX",
    "architecture": "Архитектура/процесс",
    "business_goal": "Бизнес-цель",
    "security": "Безопасность",
    "testing": "Тестирование",
    "other": "Прочее",
}

PLACEHOLDER = re.compile(
    r"(\bTBD\b|\bTODO\b|\bTBA\b|заполня(ется|ются)|будет (описано|добавлено|уточнено)|не заполнен|\?\?\?|^\s*[—-]\s*$|^\s*\.\.\.\s*$)",
    re.I,
)


@dataclass
class Extraction:
    requirements: list[Requirement]
    meta_blocks: list[Block] = field(default_factory=list)
    placeholders: list[Block] = field(default_factory=list)
    context_blocks: list[Block] = field(default_factory=list)
    code_blocks: list[Block] = field(default_factory=list)


def section_kind(path: list[str]) -> str:
    joined = " / ".join(path).lower()
    for p in reversed(path):
        low = p.lower()
        if any(k in low for k in META_KEYS):
            return "meta"
    for keys, t in SECTION_TYPES:
        for p in reversed(path):
            if any(k in p.lower() for k in keys):
                return t
    return "other" if joined else "preamble"


def is_meta(path: list[str]) -> bool:
    return any(any(k in p.lower() for k in META_KEYS) for p in path)


def _summary(text: str, limit: int = 120) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    first = re.split(r"(?<=[.!?])\s", t, maxsplit=1)[0]
    if len(first) < 25 and len(t) > len(first):
        first = t
    return first if len(first) <= limit else first[: limit - 1].rstrip() + "…"


def _part_of(path: list[str], title_level_one: bool) -> str:
    if title_level_one and len(path) > 1:
        return path[1]
    return path[0] if path else ""


def extract(doc: Document) -> Extraction:
    blocks = doc.blocks
    has_h1 = sum(1 for b in blocks if b.kind == "heading" and b.level == 1) == 1
    has_headings = sum(1 for b in blocks if b.kind == "heading") >= 2
    reqs: list[Requirement] = []
    ex = Extraction(requirements=reqs)
    counter = 0

    def new_req(block_text: str, loc: Location, path: list[str], source_id: str | None, kind: str,
                rtype: str) -> Requirement:
        nonlocal counter
        counter += 1
        r = Requirement(
            id=f"REQ-{counter:03d}",
            source_id=source_id,
            source_id_kind=kind,  # type: ignore[arg-type]
            section=" / ".join(path[1:] if has_h1 else path) or (path[0] if path else ""),
            part=_part_of(path, has_h1),
            loc=loc,
            quote=block_text,
            summary=_summary(block_text),
            type=rtype,
        )
        reqs.append(r)
        return r

    i = 0
    last_req_in_section: dict[str, Requirement] = {}
    while i < len(blocks):
        b = blocks[i]
        path = b.section_path
        skey = " / ".join(path)
        if b.kind == "heading":
            i += 1
            continue
        kind = section_kind(path)
        depth = len(path) - (1 if has_h1 else 0)
        if kind == "meta":
            ex.meta_blocks.append(b)
            i += 1
            continue
        if depth <= 0 and b.kind == "paragraph" and has_headings and not EXPLICIT_ID.match(b.text.strip()):
            ex.context_blocks.append(b)  # preamble / document intro
            i += 1
            continue
        text = b.text.strip()
        if b.kind in ("paragraph", "list_item") and PLACEHOLDER.search(text) and len(text.split()) <= 8:
            ex.placeholders.append(b)
            i += 1
            continue
        if b.kind == "code":
            ex.code_blocks.append(b)
            if text.startswith(("{", "[")) or skey in last_req_in_section:
                if skey in last_req_in_section:
                    last_req_in_section[skey].context.append(text)
                i += 1
                continue
            r = new_req(text, b.loc, path, None, "none", kind if kind != "other" else "architecture")
            last_req_in_section[skey] = r
            i += 1
            continue
        if b.kind in ("paragraph", "list_item") and len(re.findall(r"\w+", text)) < 3:
            if skey in last_req_in_section:
                last_req_in_section[skey].context.append(text)
            else:
                ex.context_blocks.append(b)
            i += 1
            continue
        if b.kind == "table_header":
            # gather rows of this table
            rows = []
            j = i + 1
            while j < len(blocks) and blocks[j].kind == "table_row" and blocks[j].table_id == b.table_id:
                rows.append(blocks[j])
                j += 1
            header = b.cells
            is_kv = len(header) == 2
            if is_kv and rows:
                quote = "\n".join(f"{r.cells[0]}: {r.cells[1] if len(r.cells) > 1 else ''}" for r in rows)
                loc = Location(line_start=rows[0].loc.line_start, line_end=rows[-1].loc.line_end,
                               page=rows[0].loc.page, section=b.loc.section)
                r = new_req(quote, loc, path, None, "none", kind if kind != "other" else "api")
                r.summary = f"Таблица «{b.loc.section}»: " + ", ".join(x.cells[0] for x in rows[:6])
                last_req_in_section[skey] = r
            else:
                for n, row in enumerate(rows, start=1):
                    if not any(c.strip() for c in row.cells):
                        ex.placeholders.append(row)
                        continue
                    first = row.cells[0] if row.cells else ""
                    sid, sk = None, "none"
                    if first and re.fullmatch(r"[\w.\-‐–]{1,40}", first) and " " not in first:
                        sid, sk = first, "explicit"
                    elif EXPLICIT_ID.match(first + " x"):
                        sid, sk = EXPLICIT_ID.match(first + " x").group("id"), "explicit"  # type: ignore[union-attr]
                    else:
                        sid, sk = f"{b.loc.section}, стр. табл. {n}", "derived"
                    r = new_req(row.text, row.loc, path, sid, sk, kind if kind != "other" else "other")
                    last_req_in_section[skey] = r
            i = j
            continue
        if b.kind == "table_row":  # orphan row
            r = new_req(text, b.loc, path, None, "none", kind)
            last_req_in_section[skey] = r
            i += 1
            continue
        # paragraph or list item
        sid, sk = None, "none"
        m = EXPLICIT_ID.match(text)
        if m and not re.fullmatch(r"\d{3}", m.group("id")):
            sid, sk = m.group("id"), "explicit"
        elif b.kind == "list_item" and b.list_no is not None:
            sid, sk = f"{b.loc.section}, п. {b.list_no}", "derived"
        status = re.match(r"^(\d{3})\.\s", text)
        if status and not sid:
            sid, sk = f"HTTP {status.group(1)}", "derived"
        rtype = kind if kind not in ("other", "preamble") else "other"
        r = new_req(text, b.loc, path, sid, sk, rtype)
        if m and sk == "explicit":
            r.summary = _summary(m.group("rest"))
        last_req_in_section[skey] = r
        i += 1
    return ex
