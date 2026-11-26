"""Structural segmentation of normalized lines into headings, paragraphs, list items, tables, code."""
from __future__ import annotations

import re

from ..models import Block, Line, Location

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_LIST = re.compile(r"^\s*(?:[*\-+•]|(\d{1,3})[.)])\s+(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
_HR = re.compile(r"^\s*([-*_])\1{2,}\s*$")
_REQ_START = re.compile(r"^(?:\*\*)?[A-ZА-ЯЁ]{1,6}[-‐–_.]?\d+(?:\.\d+)*[.):]?(?:\*\*)?\s+\S")


def clean_inline(text: str) -> str:
    """Strip markdown emphasis/code marks while keeping the visible text."""
    t = re.sub(r"`([^`]*)`", r"\1", text)
    t = re.sub(r"\*\*([^*]+)\*\*", r"\1", t)
    t = re.sub(r"__([^_]+)__", r"\1", t)
    t = re.sub(r"(?<!\w)\*([^*\n]+)\*(?!\w)", r"\1", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip()


def _split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [clean_inline(c.strip()) for c in s.split("|")]


def build_blocks(lines: list[Line]) -> list[Block]:
    blocks: list[Block] = []
    path: list[tuple[int, str]] = []
    i, n = 0, len(lines)
    table_id = 0

    def section_path() -> list[str]:
        return [t for _, t in path]

    def loc(a: int, b: int) -> Location:
        return Location(
            line_start=lines[a].no,
            line_end=lines[b].no,
            page=lines[a].page,
            section=path[-1][1] if path else "",
        )

    while i < n:
        raw = lines[i].text
        s = raw.strip()
        if not s or _HR.match(s):
            i += 1
            continue
        # fenced code
        if s.startswith("```") or s.startswith("~~~"):
            fence = s[:3]
            j = i + 1
            while j < n and not lines[j].text.strip().startswith(fence):
                j += 1
            body = "\n".join(l.text for l in lines[i + 1 : j]).strip()
            end = min(j, n - 1)
            blocks.append(Block(kind="code", text=body, loc=loc(i, end), section_path=section_path()))
            i = j + 1
            continue
        m = _HEADING.match(s)
        if m:
            level = len(m.group(1))
            title = clean_inline(m.group(2))
            while path and path[-1][0] >= level:
                path.pop()
            path.append((level, title))
            blocks.append(Block(kind="heading", text=title, level=level, loc=loc(i, i), section_path=section_path()))
            i += 1
            continue
        # table
        if s.startswith("|") and i + 1 < n and _TABLE_SEP.match(lines[i + 1].text.strip()):
            table_id += 1
            header = _split_row(s)
            blocks.append(
                Block(kind="table_header", text=" | ".join(header), cells=header, header=header,
                      loc=loc(i, i), section_path=section_path(), table_id=table_id)
            )
            j = i + 2
            while j < n and lines[j].text.strip().startswith("|"):
                cells = _split_row(lines[j].text)
                text = "; ".join(
                    f"{h}: {c}" if h else c for h, c in zip(header + [""] * len(cells), cells) if c or h
                )
                blocks.append(
                    Block(kind="table_row", text=text, cells=cells, header=header, loc=loc(j, j),
                          section_path=section_path(), table_id=table_id)
                )
                j += 1
            i = j
            continue
        # list item (with continuation lines)
        lm = _LIST.match(raw)
        if lm:
            j = i + 1
            parts = [lm.group(2)]
            while j < n:
                nxt = lines[j].text
                ns = nxt.strip()
                if not ns or _LIST.match(nxt) or _HEADING.match(ns) or ns.startswith(("|", "```")):
                    break
                if not nxt.startswith((" ", "\t")):
                    break
                parts.append(ns)
                j += 1
            blocks.append(
                Block(kind="list_item", text=clean_inline(" ".join(parts)), loc=loc(i, j - 1),
                      section_path=section_path(), list_no=int(lm.group(1)) if lm.group(1) else None)
            )
            i = j
            continue
        # paragraph
        j = i + 1
        parts = [s]
        while j < n:
            ns = lines[j].text.strip()
            if not ns or _HEADING.match(ns) or _LIST.match(lines[j].text) or ns.startswith(("|", "```")) or _HR.match(ns):
                break
            # a line that starts with a requirement identifier (FR-1., Ф-2.) is a new statement
            if _REQ_START.match(ns):
                break
            # a hard line break followed by a bold lead label starts a new logical statement
            if lines[j - 1].text.endswith("  ") and re.match(r"^\*\*[^*]{1,40}\*\*", ns):
                break
            parts.append(ns)
            j += 1
        blocks.append(Block(kind="paragraph", text=clean_inline(" ".join(parts)), loc=loc(i, j - 1),
                            section_path=section_path()))
        i = j
    return blocks
