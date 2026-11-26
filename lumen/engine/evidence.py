"""Evidence index — anti-hallucination core.

Every quote produced by rules or the LLM is matched against the original document. A quote
is accepted only if it is found verbatim (after neutral normalization of markdown, quotes and
whitespace) or with high fuzzy similarity; the reported quote is then replaced by the exact
source fragment and its real line/page position.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

from ..models import Document, Location, Requirement
from ..parsing.structure import clean_inline

_STRIP = re.compile(r"[|*`#:;«»\"'“”„()\[\]_]")
_WS = re.compile(r"\s+")


def norm(text: str) -> str:
    t = text.lower().replace("ё", "е")
    t = t.replace("—", "-").replace("–", "-").replace("‐", "-").replace(" ", " ").replace(" ", " ")
    t = _STRIP.sub(" ", t)
    t = re.sub(r"\s*([.,!?])\s*", r"\1 ", t)
    return _WS.sub(" ", t).strip(" .,")


@dataclass
class Match:
    text: str  # exact source fragment (inline markdown cleaned)
    line_start: int
    line_end: int
    page: int | None
    score: float


class EvidenceIndex:
    def __init__(self, doc: Document, requirements: list[Requirement] | None = None):
        self.doc = doc
        self.lines = doc.lines
        self.norm_lines = [norm(l.text) for l in doc.lines]
        self.reqs = requirements or []
        # flat normalized text with char→line mapping
        self._flat = ""
        self._map: list[int] = []
        for idx, nl in enumerate(self.norm_lines):
            if not nl:
                continue
            start = len(self._flat)
            self._flat += nl + " "
            self._map.extend([idx] * (len(self._flat) - start))

    def section_of(self, line_no: int) -> str:
        best = ""
        for b in self.doc.blocks:
            if b.loc.line_start <= line_no and b.section_path:
                best = b.section_path[-1]
            if b.loc.line_start > line_no:
                break
        return best

    def location(self, a: int, b: int) -> Location:
        la, lb = self.lines[a - 1], self.lines[b - 1]
        return Location(line_start=la.no, line_end=lb.no, page=la.page, section=self.section_of(la.no))

    def _fragment(self, a_idx: int, b_idx: int, nq: str) -> str:
        raw = " ".join(clean_inline(self.lines[i].text.strip().strip("|").replace("|", " | "))
                       for i in range(a_idx, b_idx + 1))
        raw = re.sub(r"\s*\|\s*", " | ", raw).strip(" |")
        raw = re.sub(r"^(?:[*\-+•]|\d{1,3}[.)])\s+(?=\S)", "", raw)
        # narrow to the sentence-sized window that contains the quote when the line is long
        if len(raw) > max(220, len(nq) * 2):
            sentences = re.split(r"(?<=[.!?])\s+", raw)
            hits = [s for s in sentences if nq[:30] and nq[:30] in norm(s)]
            if hits:
                return " ".join(hits)[:400]
        return raw[:600]

    def find(self, quote: str) -> Match | None:
        nq = norm(quote)
        if len(nq) < 4:
            return None
        pos = self._flat.find(nq)
        if pos >= 0:
            a = self._map[pos]
            b = self._map[min(pos + len(nq) - 1, len(self._map) - 1)]
            return Match(self._fragment(a, b, nq), self.lines[a].no, self.lines[b].no, self.lines[a].page, 1.0)
        # fuzzy: best window of 1..4 consecutive lines
        best: tuple[float, int, int] = (0.0, -1, -1)
        nonempty = [i for i, t in enumerate(self.norm_lines) if t]
        qset = set(nq.split())
        for k, i in enumerate(nonempty):
            window = ""
            for span in range(0, 4):
                if k + span >= len(nonempty):
                    break
                j = nonempty[k + span]
                window = (window + " " + self.norm_lines[j]).strip()
                wset = set(window.split())
                if len(qset & wset) < 0.45 * len(qset):
                    continue
                if len(window) < len(nq) * 0.5:
                    continue
                sm = difflib.SequenceMatcher(None, nq, window, autojunk=False)
                # containment-oriented score: how much of the quote is covered by the window
                blocks = sum(bl.size for bl in sm.get_matching_blocks())
                score = blocks / max(len(nq), 1)
                if len(window) > len(nq) * 3:
                    score *= 0.92
                if score > best[0]:
                    best = (score, i, j)
        if best[0] >= 0.82:
            _, a, b = best
            return Match(self._fragment(a, b, nq), self.lines[a].no, self.lines[b].no, self.lines[a].page, best[0])
        return None

    def req_for_line(self, line_no: int) -> list[str]:
        return [r.id for r in self.reqs if r.loc.line_start <= line_no <= r.loc.line_end]

    def line_text(self, line_no: int) -> str:
        if 1 <= line_no <= len(self.lines):
            return self._fragment(line_no - 1, line_no - 1, "")
        return ""
