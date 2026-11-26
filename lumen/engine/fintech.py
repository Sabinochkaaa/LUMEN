"""LÜMEN Risk Engine — FinTech aspects catalogue with applicability-first evaluation."""
from __future__ import annotations

import re

from ..models import FintechCheck, Requirement

# key, name, keyword regex (mention detection)
ASPECTS: list[tuple[str, str, str]] = [
    ("payments", "Платёжные операции", r"платеж|платёж|покупк|оплат|транзакц|payment|purchase|операци"),
    ("money_currency", "Денежные суммы и валюты", r"сумм|₸|тенге|\bKZT\b|валют|currency|\bUSD\b|руб"),
    ("precision", "Точность денежных вычислений и минимальные единицы", r"тиын|копе|цент|minor unit|decimal|точност"),
    ("rounding", "Округление", r"округл|rounding"),
    ("redelivery", "Повторная доставка событий", r"повторн\w* доставк|redeliver|at-least-once|повторн\w* событ"),
    ("idempotency", "Идемпотентность операций", r"идемпотент|idempoten|повторн\w* (доставк|сохранен|запрос)|исходный итог"),
    ("duplicates", "Дублирование платежей/уведомлений", r"дубл|duplicate|максимум один|не более одного"),
    ("timeouts", "Тайм-ауты", r"тайм-?аут|timeout|в течение"),
    ("retries", "Повторные попытки", r"повторн\w* попыт|retry|ретра"),
    ("provider_errors", "Ошибки внешних провайдеров", r"ошибк\w* (провайдер|внешн|сервис)|\b5\d\d\b|сбой"),
    ("refunds", "Отмены и возвраты", r"возврат|отмен|refund|reversal|chargeback"),
    ("statuses", "Статусы операций", r"статус\w* (операц|платеж|покуп)|проведённ|проведен|авторизац\w* покуп"),
    ("concurrency", "Конкурентные транзакции", r"конкурент|параллельн|одновременн|concurren|race|блокировк"),
    ("authn", "Аутентификация и авторизация", r"аутентиф|авториз|bearer|токен|token|сесси|oauth"),
    ("access_control", "Разграничение доступа", r"принадлежност|чуж\w+ карт|доступ запрещ|forbidden|роль|права доступа"),
    ("logging", "Журналирование и аудит", r"журнал|\bлог|audit|аудит"),
    ("pii", "Защита персональных и платёжных данных", r"персональн|маск|последние четыре|\bPAN\b|pci|шифр|encrypt"),
    ("unavailability", "Недоступность внешних сервисов", r"недоступн|unavailable|fallback|деградац"),
    ("consistency", "Согласованность данных", r"согласованн|consistency|транзакционн|итог"),
    ("recovery", "Восстановление после сбоев и откат", r"восстановл|recovery|rollback|откат|резервн"),
]
FINTECH_CONTEXT = re.compile(r"(карт|платеж|платёж|банк|счёт|счет|перевод|покупк|₸|тенге|KZT|payment|card|bank)", re.I)


def is_fintech(text: str) -> bool:
    return len(FINTECH_CONTEXT.findall(text)) >= 3


def offline_checks(text: str, reqs: list[Requirement]) -> list[FintechCheck]:
    fin = is_fintech(text)
    out = []
    for key, name, rx in ASPECTS:
        r = re.compile(rx, re.I)
        hits = [q.id for q in reqs if r.search(q.quote)]
        if not fin:
            out.append(FintechCheck(key=key, aspect=name, applicable="no", status="na",
                                    note="Документ не описывает финансовую функциональность."))
            continue
        if hits:
            out.append(FintechCheck(key=key, aspect=name, applicable="yes", status="partial", req_ids=hits[:6],
                                    note="Аспект упомянут; полноту описания оценивает семантический анализ (LLM)."))
        else:
            out.append(FintechCheck(key=key, aspect=name, applicable="unknown", status="unknown",
                                    note="В документе не упоминается. Применимость требует экспертной оценки — "
                                         "не считается дефектом автоматически."))
    return out


def aspects_for_prompt() -> list[dict]:
    return [{"key": k, "aspect": n} for k, n, _ in ASPECTS]
