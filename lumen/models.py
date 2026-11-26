"""Strict data contracts shared by every LÜMEN component (Pydantic v2)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}
SEVERITY_RU = {
    "CRITICAL": "Критический",
    "HIGH": "Высокий",
    "MEDIUM": "Средний",
    "LOW": "Низкий",
    "INFO": "Инфо",
}
CriterionStatus = Literal["ok", "issue", "na", "unknown"]


class Line(BaseModel):
    no: int  # 1-based line number in the normalized text
    text: str
    page: Optional[int] = None
    origin: str = ""  # human label of the source position ("стр. 2", "абзац 14")


class Location(BaseModel):
    line_start: int
    line_end: int
    page: Optional[int] = None
    section: str = ""

    def label(self) -> str:
        if self.line_start == self.line_end:
            lines = f"строка {self.line_start}"
        else:
            lines = f"строки {self.line_start}–{self.line_end}"
        parts = []
        if self.page:
            parts.append(f"стр. {self.page}")
        parts.append(lines)
        if self.section:
            parts.append(f"раздел «{self.section}»")
        return ", ".join(parts)


class Block(BaseModel):
    kind: Literal["heading", "paragraph", "list_item", "table_row", "table_header", "code"]
    text: str
    loc: Location
    level: int = 0
    section_path: list[str] = Field(default_factory=list)
    cells: list[str] = Field(default_factory=list)
    header: list[str] = Field(default_factory=list)
    table_id: int = 0
    list_no: Optional[int] = None


class Document(BaseModel):
    name: str
    path: str
    format: str
    sha256: str
    lines: list[Line]
    blocks: list[Block]
    pages: Optional[int] = None
    title: str = ""
    warnings: list[str] = Field(default_factory=list)

    def numbered_text(self, limit: int = 120_000) -> str:
        out, size = [], 0
        for ln in self.lines:
            row = f"{ln.no:>4}| {ln.text}"
            size += len(row) + 1
            if size > limit:
                out.append("…[документ обрезан для контекста модели]")
                break
            out.append(row)
        return "\n".join(out)


class Requirement(BaseModel):
    id: str
    source_id: Optional[str] = None
    source_id_kind: Literal["explicit", "derived", "none"] = "none"
    section: str = ""
    part: str = ""
    loc: Location
    quote: str
    summary: str
    type: str = "other"
    context: list[str] = Field(default_factory=list)


class Finding(BaseModel):
    id: str = ""
    scope: Literal["requirement", "set"] = "requirement"
    req_ids: list[str] = Field(default_factory=list)
    criterion: str
    severity: Severity
    title: str
    quote: str = ""
    loc: Optional[Location] = None
    problem: str
    risk: str = ""
    fix: str = ""
    rewrite: str = ""
    source: str = "rule"  # rule | llm | rule+llm
    rule_id: str = ""
    status: Literal["confirmed", "needs_review"] = "confirmed"
    basis: Literal["normative", "expert"] = "normative"
    standard_ref: str = ""
    confidence: float = 1.0


class Relation(BaseModel):
    source: str
    target: str
    type: Literal["depends_on", "conflicts_with", "duplicates", "refines", "implements", "traces_to"]
    status: Literal["confirmed", "needs_confirmation"] = "needs_confirmation"
    note: str = ""
    origin: str = "rule"


class Question(BaseModel):
    id: str = ""
    req_ids: list[str] = Field(default_factory=list)
    question: str
    why: str
    risk: str = ""
    options: list[str] = Field(default_factory=list)
    status: Literal["open", "clarified", "rejected"] = "open"
    answer: str = ""
    source: str = "rule"
    finding_ids: list[str] = Field(default_factory=list)


class FintechCheck(BaseModel):
    key: str
    aspect: str
    applicable: Literal["yes", "no", "unknown"] = "unknown"
    status: Literal["covered", "partial", "missing", "na", "unknown"] = "unknown"
    note: str = ""
    req_ids: list[str] = Field(default_factory=list)
    quote: str = ""
    severity: Severity = "INFO"
    recommendation: str = ""
    source: str = "rule"


class Assessment(BaseModel):
    req_id: str
    criteria: dict[str, CriterionStatus] = Field(default_factory=dict)
    score: float = 100.0
    verdict: Literal["pass", "warn", "fail"] = "pass"
    summary_llm: str = ""


class StageEvent(BaseModel):
    index: int
    total: int
    key: str
    title: str
    status: Literal["running", "done", "skipped", "error"]
    message: str = ""
    elapsed_ms: int = 0


class Passport(BaseModel):
    document_name: str
    document_title: str = ""
    document_format: str
    document_sha256: str
    analysed_at: str
    provider: str
    model: str
    agent_version: str
    agent_commit: str
    mode: Literal["llm", "offline", "mock"]
    duration_s: float = 0.0
    llm_calls: int = 0
    llm_failures: int = 0
    tokens_in: int = 0
    tokens_out: int = 0


class Scores(BaseModel):
    quality_index: float
    requirements_index: float
    set_index: float
    checked_requirements: int
    total_requirements: int
    findings_total: int
    by_severity: dict[str, int]
    contradictions: int
    incomplete: int
    unverifiable: int
    ambiguous: int
    open_questions: int
    needs_review: int
    criteria_coverage: float
    method: str


class AuditResult(BaseModel):
    id: str
    passport: Passport
    requirements: list[Requirement]
    assessments: list[Assessment]
    findings: list[Finding]
    relations: list[Relation]
    questions: list[Question]
    fintech: list[FintechCheck]
    scores: Scores
    readiness: Literal["READY", "READY WITH CONDITIONS", "NOT READY", "INSUFFICIENT DATA"]
    readiness_reason: str
    priorities: list[str]
    stages: list[StageEvent] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    demo: bool = False
    source: list[Line] = Field(default_factory=list)  # normalized document lines for the Document Lens
    private: bool = False  # not listed publicly (e.g. documents sent to the Telegram bot); reachable only by id
