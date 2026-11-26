"""LÜMEN Bench — measures how many known defects the agent catches and how much noise it adds.

A clean, carefully written specification (examples/bench/clean_spec.md) is the baseline: every finding on it is a
false positive. Each case plants exactly one known defect into a copy of it; the case is caught when the agent
reports it (the expected rule, or — for semantic defects only a model can see — any finding on the planted line).

    python -m lumen.bench                      # rules only, reproducible, no key needed
    python -m lumen.bench --provider claude-cli # rules + model
"""
from __future__ import annotations

import argparse
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

CLEAN = Path(__file__).resolve().parent.parent / "examples" / "bench" / "clean_spec.md"


@dataclass(frozen=True)
class Case:
    key: str
    title: str                 # what a reviewer would write
    find: str                  # text in the clean spec …
    replace: str               # … replaced by the defective variant
    expect: Optional[str]      # rule id prefix(es) that must fire, "A|B"; None = semantic, any finding on the planted line
    llm_only: bool = False     # not expected from deterministic rules


CASES: list[Case] = [
    Case("vague", "Нечёткое слово вместо числа в НФТ", "завершаться за 200 мс", "завершаться быстро", "R-VAGUE"),
    Case("weak", "Необязательная модальность «может»", "Система должна отклонить", "Система может отклонить", "R-WEAK"),
    Case("andor", "Конструкция «и/или»", "LIMIT_EXCEEDED и остаток", "LIMIT_EXCEEDED и/или остаток", "R-ANDOR"),
    Case("units", "Тиыны и тенге в одном требовании",
         "Клиент задаёт дневной лимит целым числом в тиынах от 100 000 до 100 000 000 включительно.",
         "Клиент задаёт дневной лимит в тенге, система сравнивает его с суммой перевода в тиынах.", "R-UNITS"),
    Case("tz", "Граница суток по городу без UTC", "UTC+5 (Asia/Almaty)", "по времени в Алматы", "R-TZ"),
    Case("nfr", "НФТ без нагрузки и перцентиля",
         "за 200 мс для 99% запросов при нагрузке 500 запросов в секунду, от получения запроса до ответа", "за 200 мс",
         "R-NFR-PROFILE"),
    Case("atomic", "Несколько утверждений в одном требовании",
         "Изменение лимита вступает в силу для переводов, созданных после сохранения настройки.",
         "Изменение лимита вступает в силу сразу после сохранения настройки. Клиент видит новый лимит в профиле. "
         "Банк отправляет клиенту push о смене лимита.", "R-ATOMIC"),
    Case("empty", "Незаполненное значение", "созданных после сохранения настройки.",
         "созданных после сохранения настройки. Срок хранения истории: —.", "R-EMPTY-VALUE"),
    Case("term", "Неопределённый банковский термин", "превысит дневной лимит.",
         "превысит дневной лимит. Возвраты уменьшают сумму переводов за сутки.", "R-TERM-refund"),
    Case("get", "Изменяющая операция через GET", "| REST type | POST |", "| REST type | GET |", "API-GET-MUTATION"),
    Case("api-empty", "Пустое поле API-контракта", "| Content-Type | application/json |", "| Content-Type | — |",
         "API-EMPTY-FIELD|R-EMPTY-VALUE"),
    Case("status", "Код ответа не описан в контракте", "* 401 Unauthorized — сессия клиента недействительна.",
         "* 401 Unauthorized — сессия клиента недействительна.\n\nПри повторном сохранении сервис возвращает 409.",
         "API-UNDEFINED-STATUS"),
    Case("version", "Нет версии документа", "| Версия | 1.2 |\n", "", "SET-VERSION"),
    Case("approvers", "Нет согласующих", "| Согласующие | Руководитель продукта, архитектор, QA-лид |\n", "",
         "SET-APPROVERS"),
    Case("placeholder", "Раздел-заглушка", "## Чек-лист ревью",
         "## Тестирование требований\n\nЗаполняется тестировщиками.\n\n## Чек-лист ревью", "SET-PLACEHOLDER"),
    # semantic defects: only a model can see them
    Case("contradiction", "Критерий приёмки противоречит диапазону лимита",
         "Исходные условия: лимит 1 000 000 тиынов, переводов за сутки нет. Действие: перевод 600 000 тиынов. "
         "Ожидаемый результат: перевод выполнен.",
         "Исходные условия: лимит 50 000 тиынов, переводов за сутки нет. Действие: перевод 40 000 тиынов. "
         "Ожидаемый результат: перевод выполнен.", None, llm_only=True),
    Case("missing-error", "Не описано поведение при отклонении",
         "* **F-3.** При отклонении система должна вернуть код ошибки LIMIT_EXCEEDED и остаток лимита в тиынах.\n", "",
         None, llm_only=True),
]


def _planted_lines(text: str, case: Case) -> set[int]:
    start = text.index(case.replace) if case.replace else text.index(case.find)
    first = text[:start].count("\n") + 1
    return set(range(first, first + max(1, case.replace.count("\n") + 1)))


def run(provider: str = "offline", model: Optional[str] = None, include_llm: Optional[bool] = None,
        verbose: bool = True) -> dict:
    from .engine.pipeline import run_audit

    base = CLEAN.read_text(encoding="utf-8")
    include_llm = provider not in ("offline",) if include_llm is None else include_llm
    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        clean_path = Path(tmp) / "clean_spec.md"
        clean_path.write_text(base, encoding="utf-8")
        clean = run_audit(clean_path, provider=provider, model=model)
        noise = [f for f in clean.findings if f.severity not in ("INFO",)]
        rows = []
        for case in CASES:
            if case.llm_only and not include_llm:
                continue
            assert case.find in base, f"bench case {case.key}: anchor text not in clean spec"
            text = base.replace(case.find, case.replace, 1)
            p = Path(tmp) / f"{case.key}.md"
            p.write_text(text, encoding="utf-8")
            res = run_audit(p, provider=provider, model=model)
            lines = _planted_lines(text, case) if case.replace else set()
            new = [f for f in res.findings if (f.rule_id, f.title) not in {(n.rule_id, n.title) for n in noise}]
            if case.expect:
                hit = any(f.rule_id.startswith(tuple(case.expect.split("|"))) for f in new)
            else:
                hit = any(f.loc and lines & set(range(f.loc.line_start, f.loc.line_end + 1)) for f in new) or \
                      (not case.replace and any(f.severity in ("CRITICAL", "HIGH", "MEDIUM") for f in new))
            rows.append({"key": case.key, "title": case.title, "expect": case.expect or "семантика (LLM)",
                         "caught": hit, "llm_only": case.llm_only})
            if verbose:
                print(f"  {'✔' if hit else '✘'} {case.title}", flush=True)
    caught = sum(r["caught"] for r in rows)
    return {"provider": provider, "model": clean.passport.model, "cases": rows, "caught": caught, "total": len(rows),
            "recall": round(caught / len(rows), 3) if rows else 0.0, "false_positives": len(noise),
            "noise": [f"{f.rule_id}: {f.title}" for f in noise], "seconds": round(time.time() - t0, 1)}


def to_markdown(res: dict) -> str:
    lines = [f"# LÜMEN Bench — {res['caught']} из {res['total']} заложенных дефектов найдено",
             "", f"Модель: `{res['model']}` · ложных срабатываний на чистом документе: **{res['false_positives']}** · "
                 f"{res['seconds']} с", "", "| Дефект | Ожидаемое правило | Найден |", "| --- | --- | :---: |"]
    lines += [f"| {r['title']} | `{r['expect']}` | {'да' if r['caught'] else 'нет'} |" for r in res["cases"]]
    if res["noise"]:
        lines += ["", "Срабатывания на чистом документе:", ""] + [f"* {n}" for n in res["noise"]]
    return "\n".join(lines) + "\n"


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="lumen.bench", description=__doc__.split("\n")[0])
    ap.add_argument("-p", "--provider", default="offline")
    ap.add_argument("-m", "--model")
    ap.add_argument("-o", "--output", help="записать таблицу результатов в Markdown")
    a = ap.parse_args(argv)
    print(f"LÜMEN Bench · провайдер {a.provider}")
    res = run(a.provider, a.model)
    print(f"\nНайдено {res['caught']} из {res['total']} ({res['recall']:.0%}), "
          f"ложных срабатываний на чистом документе: {res['false_positives']}")
    if a.output:
        Path(a.output).parent.mkdir(parents=True, exist_ok=True)
        Path(a.output).write_text(to_markdown(res), encoding="utf-8")
        print(f"Таблица: {a.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
