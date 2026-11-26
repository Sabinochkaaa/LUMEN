"""JSON contracts between LÜMEN Core and the LLM. All fields have safe defaults → partial answers validate."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Sev = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
St = Literal["ok", "issue", "na", "unknown"]


class LLMFinding(BaseModel):
    criterion: str = Field(description="Ключ критерия из списка")
    severity: Sev
    title: str = Field(description="Короткий заголовок дефекта, до 12 слов")
    quote: str = Field(description="ДОСЛОВНЫЙ фрагмент документа, 3–40 слов, скопированный символ в символ")
    problem: str = Field(description="Что не так и почему это проблема")
    risk: str = ""
    fix: str = ""
    rewrite: str = Field("", description="Улучшенная формулировка, если возможна; без выдумывания значений — "
                                         "неизвестные величины обозначай как <уточнить: …>")
    confidence: float = Field(0.8, ge=0, le=1)


class LLMReqAudit(BaseModel):
    id: str
    type: str = ""
    summary: str = Field("", description="Краткая формулировка требования, до 15 слов")
    criteria: dict[str, St] = Field(default_factory=dict)
    findings: list[LLMFinding] = Field(default_factory=list)


class ReqAuditResponse(BaseModel):
    requirements: list[LLMReqAudit] = Field(default_factory=list)


class LLMSetIssue(BaseModel):
    kind: Literal["conflict", "duplicate", "gap", "terminology", "numeric", "integration", "scope", "other"]
    criterion: str = "set_consistent"
    severity: Sev
    title: str
    req_ids: list[str] = Field(default_factory=list)
    quotes: list[str] = Field(default_factory=list, description="Дословные цитаты из документа, по одной на сторону")
    problem: str
    risk: str = ""
    fix: str = ""
    rewrite: str = ""
    confidence: float = Field(0.8, ge=0, le=1)


class LLMRelation(BaseModel):
    source: str
    target: str
    type: Literal["depends_on", "conflicts_with", "duplicates", "refines", "implements", "traces_to"]
    confident: bool = False
    note: str = ""


class SetAuditResponse(BaseModel):
    issues: list[LLMSetIssue] = Field(default_factory=list)
    relations: list[LLMRelation] = Field(default_factory=list)


class LLMFintech(BaseModel):
    key: str
    applicable: Literal["yes", "no", "unknown"] = "unknown"
    status: Literal["covered", "partial", "missing", "na", "unknown"] = "unknown"
    note: str = ""
    req_ids: list[str] = Field(default_factory=list)
    quote: str = ""
    severity: Sev = "INFO"
    recommendation: str = ""


class FintechResponse(BaseModel):
    checks: list[LLMFintech] = Field(default_factory=list)


class LLMQuestion(BaseModel):
    req_ids: list[str] = Field(default_factory=list)
    question: str
    why: str
    risk: str = ""
    options: list[str] = Field(default_factory=list)


class ClarifyResponse(BaseModel):
    questions: list[LLMQuestion] = Field(default_factory=list)


class LLMVerdict(BaseModel):
    id: str
    verdict: Literal["keep", "downgrade", "reject"]
    severity: Sev | None = None
    reason: str = ""


class VerifyResponse(BaseModel):
    verdicts: list[LLMVerdict] = Field(default_factory=list)
